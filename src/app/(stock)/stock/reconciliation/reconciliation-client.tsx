"use client";

import Link from "next/link";
import { Fragment, memo, useCallback, useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { CelluleNombre } from "@/components/tableur/cellule-nombre";
import { ZoneTableur } from "@/components/tableur/messages";
import { appliquerComptage } from "./actions";
import { qte, SEUIL_TOLERANCE_PCT } from "@/lib/stock";
import { BoutonReinitialiser } from "../_rapport/bouton-reinitialiser";
import { estErreur } from "@/lib/action-lisible";
import { Pagination, usePagination } from "@/components/pagination";
import { PARAM_PAGE, tranche, type ParPage } from "@/lib/pagination";
import { norm } from "@/lib/filtre-inventaire";
import { PilulesDomaine, type DomaineCle } from "@/components/stock/pilules-domaine";

type Art = { id: string; code: string | null; designation: string; categorie: string; theorique: number; domaine?: string };
type TriCol = "code" | "designation" | "categorie" | "theorique";
const inp = "rounded border border-input bg-background px-2 py-1 text-sm";

const valeurTri = (a: Art, col: TriCol): string | number =>
  col === "code" ? (a.code && Number.isFinite(Number(a.code)) ? Number(a.code) : a.code ? Number.MAX_SAFE_INTEGER : Number.POSITIVE_INFINITY) :
  col === "designation" ? a.designation.toLowerCase() :
  col === "categorie" ? a.categorie.toLowerCase() :
  col === "theorique" ? a.theorique : 0;

function ThTri({ col, tri, onTri, align, className, children }: {
  col: TriCol; tri: { col: TriCol; dir: 1 | -1 } | null; onTri: (c: TriCol) => void;
  align?: "right"; className?: string; children: ReactNode;
}) {
  const actif = tri?.col === col;
  return (
    <th className={`${className ?? ""} ${align === "right" ? "text-right" : ""}`}>
      <button type="button" onClick={() => onTri(col)} className={`inline-flex items-center gap-0.5 font-semibold hover:text-primary ${align === "right" ? "flex-row-reverse" : ""} ${actif ? "text-primary" : ""}`}>
        {children}<span className="w-2 text-[10px]">{actif ? (tri!.dir === 1 ? "▲" : "▼") : ""}</span>
      </button>
    </th>
  );
}

// Ligne mémoïsée à état propre : une frappe ne re-rend rien, valider une case ne re-rend que sa
// ligne. Une ligne écartée par la recherche ou par la PAGE (50 / 100 / Tout, 2026-10-08) est MASQUÉE
// (attribut hidden), pas démontée : le comptage déjà tapé n'est plus perdu, et il part avec le formulaire.
// Changer de page ou de DOMAINE (pilules Tous / Nourriture / Boissons / Autre, 2026-10-09) ne perd donc rien,
// et un seul « Appliquer le comptage » envoie les quantités de toutes les pages et de tous les domaines.
const LigneComptage = memo(function LigneComptage({ a, montrerCat, cache, onSaisie }: { a: Art; montrerCat: boolean; cache: boolean; onSaisie: (id: string, saisi: boolean) => void }) {
  const [num, setNum] = useState<number | null>(null);
  const [expl, setExpl] = useState("");
  // Le parent compte les quantités tapées (barre du bas) : elles survivent à un changement de domaine ou de page.
  useEffect(() => { onSaisie(a.id, num !== null); }, [a.id, num, onSaisie]);
  const ecart = num !== null ? num - a.theorique : null;
  const pct = ecart === null ? null : a.theorique !== 0 ? (ecart / Math.abs(a.theorique)) * 100 : ecart !== 0 ? 100 : 0;
  const horsTol = ecart !== null && Math.abs(ecart) > 0.0001 && (a.theorique === 0 ? num !== 0 : Math.abs(pct!) > SEUIL_TOLERANCE_PCT);
  const couleurEcart = ecart === null ? "text-muted-foreground" : ecart === 0 ? "text-emerald-700" : horsTol ? "text-red-700" : ecart > 0 ? "text-blue-700" : "text-amber-700";
  return (
    <>
      <tr hidden={cache || undefined} className={`even:bg-muted/25 hover:bg-accent/40 ${horsTol ? "bg-red-50/50" : ""}`}>
        <td className="text-center tabular-nums text-muted-foreground">{a.code ?? ""}</td>
        <td className="font-medium"><Link href={`/stock/catalogue/${a.id}`} className="text-primary hover:underline">{a.designation}</Link></td>
        <td className="text-muted-foreground">{montrerCat ? a.categorie : ""}</td>
        <td className="text-right tabular-nums text-muted-foreground">{qte(a.theorique)}</td>
        <td className="text-right">
          <input type="hidden" name="recon_articleId" value={a.id} />
          <CelluleNombre name="recon_physique" ligne={a.id} col={0} groupe={montrerCat ? undefined : a.categorie} quantite valeur={num} onEnregistrer={setNum}
            placeholder="0" className={`${inp} w-24 text-right`} aria-label={`Quantité physique — ${a.designation}`} />
        </td>
        <td className={`text-right font-medium tabular-nums ${couleurEcart}`}>
          {ecart === null ? "—" : <>{ecart > 0 ? "+" : ""}{qte(ecart)}{pct !== null && a.theorique !== 0 ? <span className="ml-1 text-xs">({pct > 0 ? "+" : ""}{pct.toFixed(0)}%)</span> : null}</>}
          {!horsTol && <input type="hidden" name="recon_explication" value="" />}
        </td>
      </tr>
      {horsTol && (
        <tr hidden={cache || undefined}><td colSpan={6} className="!pt-0">
          <input name="recon_explication" value={expl} onChange={(e) => setExpl(e.target.value)} required={!cache} placeholder={`Écart > ${SEUIL_TOLERANCE_PCT} % — expliquez la raison (obligatoire)`} className={`${inp} w-full border-red-300`} />
        </td></tr>
      )}
    </>
  );
});

export function ReconciliationForm({ articles, domaineInit = "", estDirection = false, pageInit = 1, parInit = 50 }: { articles: Art[]; domaineInit?: DomaineCle | ""; estDirection?: boolean; pageInit?: number; parInit?: ParPage }) {
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; texte: string } | null>(null);
  const [cle, setCle] = useState(0);
  const [q, setQ] = useState("");
  const [domaine, setDomaine] = useState<DomaineCle | "">(domaineInit);
  const [tri, setTri] = useState<{ col: TriCol; dir: 1 | -1 } | null>(null);
  // Articles dont une quantité est tapée (toutes pages, tous domaines) : la barre du bas les compte.
  const [saisis, setSaisis] = useState<ReadonlySet<string>>(new Set());
  const domaineDe = useMemo(() => new Map(articles.map((a) => [a.id, a.domaine ?? ""])), [articles]);
  const auSaisi = useCallback((id: string, saisi: boolean) => setSaisis((prev) => {
    if (prev.has(id) === saisi) return prev;
    const suivant = new Set(prev);
    if (saisi) suivant.add(id); else suivant.delete(id);
    return suivant;
  }), []);
  const nbSaisis = saisis.size;
  const nbSaisisHorsDomaine = domaine ? [...saisis].filter((id) => domaineDe.get(id) !== domaine).length : 0;
  const viderSaisis = () => setSaisis(new Set());

  const reinitialiser = () => { setMsg(null); viderSaisis(); setCle((c) => c + 1); };
  const trierPar = (col: TriCol) => setTri((t) => (t?.col !== col ? { col, dir: 1 } : t.dir === 1 ? { col, dir: -1 } : null));
  // Changer de domaine ne recharge rien : on masque les lignes des autres domaines (le comptage tapé reste) et on
  // réécrit `?domaine=` dans l'adresse affichée ; la page repart à 1 (usePagination, via `cleFiltre`).
  const choisirDomaine = (d: DomaineCle | "") => {
    setDomaine(d);
    const u = new URL(window.location.href);
    if (d) u.searchParams.set("domaine", d); else u.searchParams.delete("domaine");
    u.searchParams.delete(PARAM_PAGE);
    window.history.replaceState(null, "", `${u.pathname}${u.searchParams.size ? `?${u.searchParams}` : ""}${u.hash}`);
  };

  const comptes = useMemo(() => ({
    TOUS: articles.length,
    NOURRITURE: articles.filter((a) => a.domaine === "NOURRITURE").length,
    BOISSON: articles.filter((a) => a.domaine === "BOISSON").length,
    AUTRE: articles.filter((a) => a.domaine === "AUTRE").length,
  }), [articles]);
  const dansDomaine = useMemo(() => (domaine ? articles.filter((a) => a.domaine === domaine) : articles), [articles, domaine]);
  const visibles = useMemo(() => {
    const nq = norm(q.trim());
    return nq ? dansDomaine.filter((a) => norm(a.designation).includes(nq) || norm(a.categorie).includes(nq) || (a.code ?? "").toLowerCase().includes(nq)) : dansDomaine;
  }, [dansDomaine, q]);
  const idsVisibles = useMemo(() => new Set(visibles.map((a) => a.id)), [visibles]);
  // TOUTES les lignes (tous domaines) restent montées (triées) ; le domaine, la recherche et la page ne font que masquer.
  const ordonnees = useMemo(() => {
    if (!tri) return articles;
    return [...articles].sort((a, b) => { const x = valeurTri(a, tri.col), y = valeurTri(b, tri.col); return (x < y ? -1 : x > y ? 1 : 0) * tri.dir; });
  }, [articles, tri]);
  // Pagination : une tranche des lignes que le domaine et la recherche laissent voir (dans l'ordre affiché). Le compteur,
  // lui, parle de tout le filtre ; un autre domaine, une autre recherche ou un autre tri ramène à la page 1.
  const visiblesOrdonnees = useMemo(() => ordonnees.filter((a) => idsVisibles.has(a.id)), [ordonnees, idsVisibles]);
  const pagination = usePagination({ total: visiblesOrdonnees.length, pageInit, parInit, cleFiltre: [domaine, q, tri?.col, tri?.dir].join("|") });
  const { debut, fin } = pagination;
  const idsPage = useMemo(() => new Set(tranche(visiblesOrdonnees, { debut, fin }).map((a) => a.id)), [visiblesOrdonnees, debut, fin]);
  // En-tête de catégorie devant la première ligne AFFICHÉE de chaque catégorie, et en tête de page (sans tri).
  const lignes = useMemo(() => {
    const res: { a: Art; cache: boolean; enTete: boolean }[] = [];
    let derniereCat: string | null = null;
    for (const a of ordonnees) {
      const cache = !idsPage.has(a.id);
      res.push({ a, cache, enTete: !tri && !cache && a.categorie !== derniereCat });
      if (!cache) derniereCat = a.categorie;
    }
    return res;
  }, [ordonnees, idsPage, tri]);

  const submit = (fd: FormData) => {
    setMsg(null);
    // Le champ `domaine` ne désigne la fiche archivée que si TOUT ce qui est compté appartient au domaine affiché :
    // des quantités tapées dans un autre domaine le rendraient faux, on ne l'envoie alors pas (comme « Tous »).
    const ids = fd.getAll("recon_articleId").map(String);
    const phys = fd.getAll("recon_physique").map((v) => String(v).trim());
    if (ids.some((id, i) => phys[i] !== "" && domaineDe.get(id) !== domaine)) fd.delete("domaine");
    startTransition(async () => {
      const r = await appliquerComptage(fd);
      if (estErreur(r)) { setMsg({ ok: false, texte: r.erreur }); return; }
      setMsg({
        ok: true,
        texte: r.applique
          ? r.nbEcarts > 0 ? "Comptage appliqué : le stock a été ajusté au réel." : "Comptage archivé : aucun écart, le stock était juste."
          : `Comptage envoyé à la Direction (${r.nbEcarts} écart${r.nbEcarts > 1 ? "s" : ""}) : le stock sera ajusté quand elle l'aura validé.`,
      });
      viderSaisis();
      setCle((c) => c + 1);
    });
  };
  const libelleEnvoi = estDirection ? "Appliquer le comptage" : "Soumettre le comptage";

  return (
    <form key={cle} action={submit} className="space-y-3">
      {domaine && <input type="hidden" name="domaine" value={domaine} />}

      <PilulesDomaine className="w-fit max-w-full" actif={domaine} comptes={comptes} pilule={(d, p) => (
        <button type="button" onClick={() => choisirDomaine(d.cle)} className={p.className}>{p.children}</button>
      )} />

      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un article (code, nom, catégorie)…" className="w-full max-w-xs rounded-md border border-input bg-background px-3 py-1.5 text-sm" />
        <span className="text-xs text-muted-foreground">{visibles.length} / {dansDomaine.length} article(s) · écart &gt; {SEUIL_TOLERANCE_PCT}% ⇒ explication requise</span>
      </div>

      <ZoneTableur>
      <div className="tableau-normal rounded-lg border">
        <table data-tableur="" className="w-full min-w-[40rem] border-separate border-spacing-0 text-sm">
          <thead className="en-tete-collante bg-muted text-left shadow-sm">
            <tr className="[&>th]:border-b [&>th]:px-3 [&>th]:py-2 [&>th]:font-semibold">
              <ThTri col="code" tri={tri} onTri={trierPar} className="w-16">Code</ThTri>
              <ThTri col="designation" tri={tri} onTri={trierPar}>Désignation</ThTri>
              <ThTri col="categorie" tri={tri} onTri={trierPar}>Catégorie</ThTri>
              <ThTri col="theorique" tri={tri} onTri={trierPar} align="right" className="w-24">Théorique</ThTri>
              <th className="w-28 text-right">Physique</th>
              <th className="w-24 text-right">Écart</th>
            </tr>
          </thead>
          <tbody className="[&>tr>td]:border-b [&>tr>td]:px-3 [&>tr>td]:py-1.5">
            {lignes.map(({ a, cache, enTete }) => (
              <Fragment key={a.id}>
                {enTete && (
                  <tr><td colSpan={6} className="!bg-amber-100 !py-1.5 text-xs font-bold uppercase tracking-wide text-amber-900">{a.categorie} ({visibles.filter((x) => x.categorie === a.categorie).length})</td></tr>
                )}
                <LigneComptage a={a} montrerCat={!!tri} cache={cache} onSaisie={auSaisi} />
              </Fragment>
            ))}
            {visibles.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">Aucun article.</td></tr>}
          </tbody>
        </table>
      </div>
      </ZoneTableur>
      <Pagination total={visiblesOrdonnees.length} page={pagination.page} par={pagination.par} onChange={pagination.aller} libelle="articles" />
      {pagination.nbPages > 1 && <p data-pagination-note="" className="text-xs text-muted-foreground">Les quantités tapées sur toutes les pages sont conservées et envoyées ensemble par « {libelleEnvoi} ».</p>}

      {/* Barre du bas : collée au bas de la zone qui défile (la coquille réserve la place de la barre de navigation),
          donc visible pendant toute la saisie. Pas de backdrop-filter ni de fond translucide (piège PWA iOS). */}
      <div data-barre-comptage="" className="sticky bottom-0 z-20 -mx-4 space-y-2 border-t bg-background px-4 pb-2 pt-2 lg:-mx-8 lg:px-8">
        {msg && <p role="status" className={`rounded-md border px-3 py-2 text-sm ${msg.ok ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-destructive/40 bg-destructive/10 text-destructive"}`}>{msg.texte}</p>}
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <input name="origine" placeholder="Libellé du comptage (ex. Inventaire fin de mois)" className={`${inp} min-w-0 basis-full sm:basis-auto sm:min-w-64 sm:flex-1`} />
          <p data-compte-saisis="" aria-live="polite" className="min-w-0 flex-1 text-xs text-muted-foreground sm:flex-none">
            <span className="font-medium tabular-nums text-foreground">{nbSaisis}</span> compté{nbSaisis > 1 ? "s" : ""}
            {nbSaisisHorsDomaine > 0 && <> (dont {nbSaisisHorsDomaine} hors du domaine affiché)</>}
          </p>
          <BoutonReinitialiser estDirection={estDirection} onClick={reinitialiser} />
          <button disabled={isPending} className="min-h-11 rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50 lg:min-h-0">
            {isPending ? "Application…" : libelleEnvoi}
          </button>
        </div>
      </div>
    </form>
  );
}

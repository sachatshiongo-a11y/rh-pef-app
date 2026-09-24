"use client";

import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { qte } from "@/lib/stock";
import { saisirCommandeResto, saisirCommandeLegume, rafraichirJournalier } from "./actions";
import { normTexte } from "@/lib/texte";
import { estErreur, messageDe } from "@/lib/action-lisible";
import { CelluleNombre, type ContexteCase } from "@/components/tableur/cellule-nombre";

export type CmdArticle = { id: string; designation: string; categorie: string };
export type CmdJour = { iso: string; label: string };

const inp = "w-14 rounded border border-input bg-background px-1 py-1 text-center text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-60";

/** Repos après la dernière case enregistrée avant de revalider la page (une fois pour toute la rafale). */
const REPOS_AVANT_RAFRAICHISSEMENT_MS = 3000;

/**
 * Saisie des commandes de livraison au restaurant : quantité par article et par jour, groupée par
 * catégorie, avec recherche d'article. Tableur « comme Excel » (cases partagées `CelluleNombre`).
 *
 * Performance (mesurée, cf. commande-grid.rendus.test.tsx) : une frappe ne re-rend rien ; une case
 * validée ne re-rend que sa ligne ; un rafraîchissement serveur aux valeurs inchangées ne re-rend
 * AUCUNE ligne (les lignes se comparent par valeurs, pas par identité des objets reçus).
 */
export function CommandeGrid({ articles, jours, commandes, peutModifier }: {
  articles: CmdArticle[];
  jours: CmdJour[];
  commandes: Record<string, number>;
  peutModifier: boolean;
}) {
  const [q, setQ] = useState("");
  // Valeurs saisies ici, prioritaires sur celles reçues du serveur : elles survivent au filtre
  // (une ligne masquée puis ré-affichée retrouve ce qui a été tapé) et font les totaux en direct.
  const [saisies, setSaisies] = useState<Record<string, number | null>>({});
  const [enCours, setEnCours] = useState(0);
  const [erreur, setErreur] = useState<string | null>(null);

  // L'enregistreur est UNIQUE et stable pour toute la grille (sinon chaque case se re-rendrait) :
  // il lit jours et articles au moment de l'appel.
  const courant = useRef({ jours, articles });
  useLayoutEffect(() => { courant.current = { jours, articles }; });

  // Revalidation groupée : une fois la saisie au repos, et en quittant l'onglet.
  const aRafraichir = useRef(false);
  const minuteur = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const rafraichir = useCallback(() => {
    clearTimeout(minuteur.current);
    if (!aRafraichir.current) return;
    aRafraichir.current = false;
    // Les valeurs sont déjà en base : un échec ici ne coûte qu'un affichage moins frais ailleurs.
    rafraichirJournalier().catch(() => { aRafraichir.current = true; });
  }, []);
  useEffect(() => () => rafraichir(), [rafraichir]);

  const onEnregistrer = useCallback(async (v: number | null, { ligne, col, precedente }: ContexteCase) => {
    const { jours: js, articles: arts } = courant.current;
    const jour = js[col];
    const k = `${ligne}_${jour.iso}`;
    setSaisies((p) => ({ ...p, [k]: v }));
    setEnCours((n) => n + 1);
    clearTimeout(minuteur.current);
    try {
      const r = ligne.startsWith("legume:")
        ? await saisirCommandeLegume(ligne.slice(7), jour.iso, v ?? 0)
        : await saisirCommandeResto(ligne, jour.iso, v ?? 0);
      if (estErreur(r)) throw new Error(r.erreur);
      aRafraichir.current = true;
    } catch (e) {
      setSaisies((p) => ({ ...p, [k]: precedente })); // le total ne compte que ce qui est en base
      const nom = arts.find((a) => a.id === ligne)?.designation ?? ligne;
      setErreur(`${nom} (${jour.label}) non enregistré : ${messageDe(e)}`);
      throw e; // … et la case le montre en rouge
    } finally {
      setEnCours((n) => n - 1);
      minuteur.current = setTimeout(rafraichir, REPOS_AVANT_RAFRAICHISSEMENT_MS);
    }
  }, [rafraichir]);

  const visibles = useMemo(() => {
    const nq = normTexte(q.trim());
    return nq ? articles.filter((a) => normTexte(a.designation).includes(nq) || normTexte(a.categorie).includes(nq)) : articles;
  }, [articles, q]);

  const valeur = (id: string, iso: string): number | null => {
    const k = `${id}_${iso}`;
    const v = k in saisies ? saisies[k] : commandes[k];
    return v ? v : null; // 0 = pas de commande : case vide (« — »)
  };
  const totauxJour = jours.map((j) => visibles.reduce((t, a) => t + (valeur(a.id, j.iso) ?? 0), 0));

  return (
    <div className="space-y-2">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un article…" className="w-full max-w-xs rounded-md border border-input bg-background px-3 py-1.5 text-sm" />
      <p className="text-xs text-muted-foreground">{visibles.length} / {articles.length} article(s)</p>
      {erreur && (
        <p className="flex items-start justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <span>{erreur} La case est restée en rouge : revenez-y et validez pour réessayer.</span>
          <button type="button" onClick={() => setErreur(null)} className="shrink-0 text-xs underline">Masquer</button>
        </p>
      )}
      <div className="max-h-[70vh] overflow-auto rounded-lg border [scrollbar-gutter:stable]">
        <table data-tableur="" className="w-full min-w-[48rem] border-separate border-spacing-0 text-sm">
          <thead className="sticky top-0 z-20 bg-muted text-left shadow-sm">
            <tr className="[&>th]:border-b [&>th]:px-3 [&>th]:py-2 [&>th]:font-semibold">
              <th className="sticky left-0 z-30 bg-muted">Article</th>
              {jours.map((j) => <th key={j.iso} className="!text-right">{j.label}</th>)}
              <th className="!text-right">Total</th>
            </tr>
          </thead>
          <tbody className="[&>tr>td]:border-b [&>tr>td]:px-3 [&>tr>td]:py-1.5">
            {visibles.map((a, i) => (
              <Fragment key={a.id}>
                {(i === 0 || visibles[i - 1].categorie !== a.categorie) && (
                  <tr><td colSpan={jours.length + 2} className="sticky left-0 !bg-amber-100 !py-1.5 text-xs font-bold uppercase tracking-wide text-amber-900">{a.categorie}</td></tr>
                )}
                <LigneCommande a={a} jours={jours} valeurs={jours.map((j) => valeur(a.id, j.iso))} peutModifier={peutModifier} onEnregistrer={onEnregistrer} />
              </Fragment>
            ))}
            {visibles.length === 0 && <tr><td colSpan={jours.length + 2} className="px-3 py-6 text-center text-muted-foreground">Aucun article pour cette recherche.</td></tr>}
          </tbody>
          {visibles.length > 0 && (
            <tfoot className="sticky bottom-0">
              <tr className="bg-muted/60 font-semibold [&>td]:px-3 [&>td]:py-2">
                <td className="sticky left-0 z-10 bg-muted/60">Total jour</td>
                {totauxJour.map((t, i) => <td key={i} className="text-right">{t > 0 ? qte(t) : ""}</td>)}
                <td className="text-right">{qte(totauxJour.reduce((x, y) => x + y, 0))}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {enCours > 0 && <p className="text-xs text-muted-foreground">Enregistrement…</p>}
    </div>
  );
}

type PropsLigne = {
  a: CmdArticle; jours: CmdJour[]; valeurs: (number | null)[]; peutModifier: boolean;
  onEnregistrer: (v: number | null, c: ContexteCase) => Promise<void>;
};

// Comparaison PAR VALEURS : un rafraîchissement serveur renvoie de nouveaux objets aux mêmes
// valeurs — la ligne ne doit pas se re-rendre pour autant (avant : les 178 lignes à chaque case).
const memesProps = (p: PropsLigne, n: PropsLigne) =>
  p.a.id === n.a.id && p.a.designation === n.a.designation &&
  p.peutModifier === n.peutModifier && p.onEnregistrer === n.onEnregistrer &&
  p.jours.length === n.jours.length && p.jours.every((j, i) => j.iso === n.jours[i].iso && j.label === n.jours[i].label) &&
  p.valeurs.length === n.valeurs.length && p.valeurs.every((v, i) => v === n.valeurs[i]);

const LigneCommande = memo(function LigneCommande({ a, jours, valeurs, peutModifier, onEnregistrer }: PropsLigne) {
  const total = valeurs.reduce<number>((x, y) => x + (y ?? 0), 0);
  return (
    <tr className="even:bg-muted/25 hover:bg-accent/40">
      <td className="sticky left-0 z-10 bg-background font-medium">{a.designation}</td>
      {jours.map((j, i) => (
        <td key={j.iso} className="text-right">
          <CelluleNombre ligne={a.id} col={i} valeur={valeurs[i]} onEnregistrer={onEnregistrer} min={0}
            disabled={!peutModifier} placeholder="—" className={inp} aria-label={`${a.designation} — ${j.label}`} />
        </td>
      ))}
      <td className="text-right font-semibold">{total > 0 ? qte(total) : ""}</td>
    </tr>
  );
}, memesProps);

"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { mouvementManuel, supprimerMouvement, supprimerMouvementsEnLot } from "./actions";
import { BoutonReinitialiser } from "../_rapport/bouton-reinitialiser";
import { qte, uniteAffichee, usd } from "@/lib/stock";
import { estErreur } from "@/lib/action-lisible";
import { AVERTISSEMENT_LIVRAISON } from "@/lib/stock-restaurant";
import { ChangerMotif } from "./changer-motif";
import { ChangerDate } from "./changer-date";
import { ChoixRecherche } from "@/components/choix-recherche";
import { ChampNombre } from "@/components/champ-nombre";
import { optionsArticles } from "@/lib/recherche-options";
import { BORNE_TOUT_LE_FILTRE, type ColonneMouvements as Colonne, type FiltreMouvements, type SelectionMouvements } from "@/lib/filtre-mouvements";
import { jourCourantKinshasaISO } from "@/lib/heure-kinshasa";
import { MESSAGE_MOTIF_SORTIE } from "@/lib/motif-sortie";
import { lireNombreSaisi } from "@/lib/nombre";
import { similairesEnStock } from "@/lib/article-proche";

/** Pour un article dont la livraison n'alimentera pas le restaurant : quoi faire, et où. */
export type ConseilLivraison = { texte: string; href: string };

export { AVERTISSEMENT_LIVRAISON };

/**
 * Article proposé dans une ligne. `quantite` : stock disponible (unité de l'article), lu par la page —
 * absent = inconnu de l'écran (le serveur tranche) ; `domaine` sert aux articles proches proposés.
 */
type Art = { id: string; designation: string; nomCourt?: string | null; code?: string | null; unite?: string | null; domaine?: string; quantite?: number; actif?: boolean };
const inp = "rounded border border-input bg-background px-2 py-1 text-sm";

// Version sérialisable d'un mouvement (Decimal/Date convertis) — passée du serveur au client.
export type MvtLite = {
  id: string;
  articleId: string;
  designation: string;
  dateISO: string; // AAAA-MM-JJ
  origine: string | null;
  type: string;
  quantite: number;
  /** Unité de l'article (le mouvement n'en porte pas) ; absente : « — » à l'écran, jamais devinée. */
  unite?: string | null;
  valeur: number | null;
  valeurEstimee: boolean;
  facture: { id: string; numero: string | null } | null;
  bc: { id: string; numero: string } | null;
  fournId: string | null;
  fournNom: string | null;
  /** Sortie : motif (LIVRAISON_RESTAURANT | PERTE ; null = sans motif). */
  motif?: string | null;
  /** Entrée de la Liste d'achat : DLC saisie (AAAA-MM-JJ), facultative. */
  dlcISO?: string | null;
};

const MOTIF_CHIP: Record<string, { texte: string; classe: string }> = {
  LIVRAISON_RESTAURANT: { texte: "Livraison restaurant", classe: "bg-sky-100 text-sky-900" },
  PERTE: { texte: "Perte", classe: "bg-red-100 text-red-900" },
  "": { texte: "sans motif", classe: "bg-muted text-muted-foreground" },
};

const chip = "rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/20";

/**
 * Bandeau au-dessus des colonnes quand le filtre compte plus de mouvements que l'écran n'en montre
 * (le 2026-09-29, 26 sorties non affichées sont restées sans motif : une mention discrète ne suffisait pas).
 */
export function BandeauPlafond({ affiches, total, estDirection }: { affiches: number; total: number; estDirection: boolean }) {
  return (
    <div role="status" data-bandeau="plafond" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      <span className="font-semibold">{affiches} mouvements affichés sur {total}</span> : les plus anciens ne sont pas à l&apos;écran.{" "}
      {estDirection ? "Sélectionnez tout le filtre ou affinez par mois, produit ou motif." : "Affinez par mois, produit ou motif."}
    </div>
  );
}

/** Pour « sélectionner tout le filtre » : le filtre normalisé, la colonne, son libellé et son total. */
export type ToutLeFiltre = { filtre: FiltreMouvements; colonne: Colonne; libelle: string; total: number };

/**
 * Colonne de mouvements (entrées ou sorties) groupés par jour, avec sélection multiple et
 * suppression groupée (Direction) — même logique « actions groupées » que le reste de l'app.
 * Quand tout l'affiché est coché et que le filtre compte davantage, la barre propose de
 * sélectionner TOUT le filtre (à la Gmail) : les actions visent alors l'ensemble, recompté par le serveur.
 */
export function ColonneMouvements({ titre, mouvements, signe, couleur, estDirection, requalifiable = false, peutChangerDate = false, toutLeFiltre }: {
  titre: string; mouvements: MvtLite[]; signe: string; couleur: string; estDirection: boolean;
  /** Sorties : la Direction peut changer le motif des lignes cochées (sans toucher au stock). */
  requalifiable?: boolean;
  /**
   * Sorties : changer la date des lignes cochées, ou d'une ligne (📅) — tout compte de l'espace Stock
   * (décision Direction du 2026-10-08) ; la Direction l'a toujours sur une colonne requalifiable.
   */
  peutChangerDate?: boolean;
  toutLeFiltre?: ToutLeFiltre;
}) {
  // Qui peut cocher : la Direction (supprimer, motif, date) ; un compte Stock sur les sorties (date seule).
  const dateOuverteAuCompte = requalifiable && (estDirection || peutChangerDate);
  const cochable = estDirection || dateOuverteAuCompte;
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [modeFiltre, setModeFiltre] = useState(false);
  // Nombre recompté par le serveur (refus « le nombre a changé ») : vaut tant que le total reçu ne change pas.
  const [recompte, setRecompte] = useState<{ base: number; n: number } | null>(null);
  /** Compte rendu de la dernière action ; `alerte` : un avertissement non bloquant l'accompagne (ambre). */
  const [info, setInfo] = useState<{ texte: string; alerte?: boolean } | null>(null);
  const [isPending, start] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  /** Sortie dont le panneau « Changer la date » est ouvert (à l'unité, depuis la ligne). */
  const [dateOuverte, setDateOuverte] = useState<string | null>(null);

  const jours = useMemo(() => {
    const acc: { cle: string; titre: string; lignes: MvtLite[] }[] = [];
    const idx = new Map<string, number>();
    for (const m of mouvements) {
      if (!idx.has(m.dateISO)) {
        idx.set(m.dateISO, acc.length);
        acc.push({ cle: m.dateISO, titre: new Date(`${m.dateISO}T00:00:00Z`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }), lignes: [] });
      }
      acc[idx.get(m.dateISO)!].lignes.push(m);
    }
    return acc;
  }, [mouvements]);

  const nom = toutLeFiltre?.colonne === "SORTIES" || requalifiable ? "sorties" : "entrées";
  const totalFiltre = toutLeFiltre ? (recompte && recompte.base === toutLeFiltre.total ? recompte.n : toutLeFiltre.total) : mouvements.length;
  const toutAfficheCoche = mouvements.length > 0 && mouvements.every((m) => sel.has(m.id));
  const filtreDepasse = !!toutLeFiltre && totalFiltre > mouvements.length;
  const enModeFiltre = modeFiltre && filtreDepasse && toutAfficheCoche;
  /** Ce que l'action vise : les id cochés, ou tout le filtre avec le nombre confirmé. */
  const selection: SelectionMouvements = enModeFiltre && toutLeFiltre
    ? { filtre: toutLeFiltre.filtre, colonne: toutLeFiltre.colonne, attendu: totalFiltre }
    : [...sel];
  const decrire = enModeFiltre && toutLeFiltre ? `${totalFiltre} ${nom} (${toutLeFiltre.libelle})` : `${sel.size} mouvement(s)`;

  const vider = () => { setSel(new Set()); setModeFiltre(false); };
  // Décocher quoi que ce soit quitte le mode « tout le filtre » (comme Gmail).
  const toggle = (id: string) => { setModeFiltre(false); setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }); };
  const toggleJour = (lignes: MvtLite[], on: boolean) => { if (!on) setModeFiltre(false); setSel((s) => { const n = new Set(s); for (const m of lignes) { if (on) n.add(m.id); else n.delete(m.id); } return n; }); };
  const totalValeur = (ms: MvtLite[]) => ms.reduce((t, m) => t + (m.valeur ?? 0), 0);
  /** Le serveur a recompté un autre nombre : rien n'est écrit, on affiche le nouveau pour reconfirmer. */
  const surRecompte = (n: number) => { if (toutLeFiltre) setRecompte({ base: toutLeFiltre.total, n }); };

  const supprimerSel = () => {
    if (!confirm(`Supprimer ${decrire} ? Leur effet sur le stock sera annulé.`)) return;
    setErreur(null); setInfo(null);
    start(async () => {
      const r = await supprimerMouvementsEnLot(selection);
      if (estErreur(r)) { setErreur(r.erreur); if (typeof (r as { nouveauNombre?: unknown }).nouveauNombre === "number") surRecompte((r as { nouveauNombre: number }).nouveauNombre); return; }
      vider();
    });
  };

  return (
    <div className="overflow-hidden rounded-lg border">
      <div className={`flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2 text-sm font-semibold ${couleur}`}>
        <span className="flex items-center gap-2">
          {cochable && mouvements.length > 0 && (
            <input type="checkbox" checked={toutAfficheCoche} onChange={(e) => { if (e.target.checked) setSel(new Set(mouvements.map((m) => m.id))); else vider(); }} aria-label={`Tout sélectionner (${mouvements.length} affichés)`} />
          )}
          {titre} <span className="font-normal opacity-70">· {mouvements.length}{filtreDepasse ? ` affichées sur ${totalFiltre}` : ""}</span>
        </span>
        <span className="text-xs font-normal opacity-80">≈ {usd(totalValeur(mouvements))}{filtreDepasse ? " (affichées)" : ""}</span>
      </div>

      {/* Barre d'actions groupées (Direction ; date des sorties : tout compte Stock) */}
      {cochable && sel.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-3 py-2 text-sm">
          {enModeFiltre && toutLeFiltre ? (
            <span data-tout-le-filtre="actif" className="font-medium">Les {totalFiltre} {nom} du filtre ({toutLeFiltre.libelle}) sont sélectionnées</span>
          ) : (
            <span className="font-medium">{sel.size} sélectionné(s)</span>
          )}
          {estDirection && <button disabled={isPending} onClick={supprimerSel} className="rounded-md border border-destructive/40 px-3 py-1 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50">Supprimer la sélection</button>}
          <button onClick={vider} className="text-xs text-muted-foreground underline">Annuler</button>
          {requalifiable && estDirection && (
            <ChangerMotif
              ids={[...sel]}
              toutLeFiltre={enModeFiltre && toutLeFiltre ? { filtre: toutLeFiltre.filtre, attendu: totalFiltre, libelle: toutLeFiltre.libelle } : undefined}
              onFait={(t) => { setInfo({ texte: t }); vider(); }}
              onRecompte={surRecompte}
            />
          )}
          {dateOuverteAuCompte && (
            <ChangerDate
              ids={[...sel]}
              toutLeFiltre={enModeFiltre && toutLeFiltre ? { filtre: toutLeFiltre.filtre, attendu: totalFiltre, libelle: toutLeFiltre.libelle } : undefined}
              onFait={(t, alerte) => { setInfo({ texte: t, alerte }); vider(); }}
              onRecompte={surRecompte}
            />
          )}
          {toutAfficheCoche && filtreDepasse && !enModeFiltre && toutLeFiltre && (
            <span data-tout-le-filtre="proposer" className="basis-full text-xs">
              Les {mouvements.length} {nom} affichées sont sélectionnées.{" "}
              {totalFiltre > BORNE_TOUT_LE_FILTRE ? (
                <span className="text-amber-900">Le filtre en compte {totalFiltre} : au-delà de {BORNE_TOUT_LE_FILTRE}, affinez par mois, produit ou motif.</span>
              ) : (
                <button type="button" onClick={() => { setModeFiltre(true); setInfo(null); setErreur(null); }} className="font-medium text-primary underline">
                  Sélectionner les {totalFiltre} {nom} du filtre ({toutLeFiltre.libelle})
                </button>
              )}
            </span>
          )}
        </div>
      )}
      {info && <p role="status" className={`border-b px-3 py-2 text-xs ${info.alerte ? "bg-amber-50 text-amber-900" : "bg-emerald-50 text-emerald-800"}`}>{info.texte}</p>}
      {erreur && <p className="border-b bg-destructive/10 px-3 py-2 text-xs text-destructive">{erreur}</p>}

      <div className="divide-y">
        {jours.map((j, ji) => {
          const tousSel = cochable && j.lignes.every((m) => sel.has(m.id));
          return (
            <details key={j.cle} open={ji === 0} className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 bg-muted/40 px-3 py-1.5 text-xs font-semibold capitalize [&::-webkit-details-marker]:hidden">
                <span className="flex items-center gap-1.5">
                  {cochable && <input type="checkbox" checked={tousSel} onClick={(e) => e.stopPropagation()} onChange={(e) => toggleJour(j.lignes, e.target.checked)} aria-label="Tout sélectionner ce jour" />}
                  <span aria-hidden className="transition-transform group-open:rotate-90">▸</span>{j.titre}
                </span>
                <span className="font-normal text-muted-foreground">{j.lignes.length} mouvement(s) · {signe}{qte(j.lignes.reduce((t, m) => t + m.quantite, 0))} · ≈ {usd(totalValeur(j.lignes))}</span>
              </summary>
              <div className="divide-y border-t">
                {j.lignes.map((m) => (
                  <div key={m.id} className={sel.has(m.id) ? "bg-primary/10" : ""}>
                  <div className="flex items-center justify-between gap-3 px-3 py-1.5">
                    <div className="flex min-w-0 items-start gap-2">
                      {cochable && <input type="checkbox" checked={sel.has(m.id)} onChange={() => toggle(m.id)} className="mt-1 shrink-0" aria-label="Sélectionner" />}
                      <div className="min-w-0">
                        <Link href={`/stock/catalogue/${m.articleId}`} className="truncate font-medium text-primary hover:underline">{m.designation}</Link>
                        {m.origine && <div className="truncate text-[11px] text-muted-foreground">{m.origine}</div>}
                        {m.dlcISO && <div data-dlc className="text-[11px] text-muted-foreground">DLC {m.dlcISO.slice(8, 10)}/{m.dlcISO.slice(5, 7)}/{m.dlcISO.slice(0, 4)}</div>}
                        {m.type === "SORTIE" && m.motif !== undefined && (
                          <span className={`mt-0.5 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium ${MOTIF_CHIP[m.motif ?? ""]?.classe ?? MOTIF_CHIP[""]!.classe}`}>{MOTIF_CHIP[m.motif ?? ""]?.texte ?? m.motif}</span>
                        )}
                        {(m.facture || m.bc || m.fournId) && (
                          <div className="mt-0.5 flex flex-wrap items-center gap-1">
                            {m.facture && <Link href={`/stock/factures/${m.facture.id}`} className={chip}>🧾 Facture{m.facture.numero ? ` ${m.facture.numero}` : ""}</Link>}
                            {m.bc && <Link href={`/stock/commandes/${m.bc.id}`} className={chip}>📄 BC {m.bc.numero}</Link>}
                            {m.fournId && <Link href={`/stock/fournisseurs/${m.fournId}`} className={chip}>🏢 {m.fournNom ?? "Fournisseur"}</Link>}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-3 text-right">
                      <div>
                        <div className="font-semibold tabular-nums">{signe}{qte(m.quantite)} <span data-unite className={`text-xs font-normal ${m.unite?.trim() ? "" : "text-muted-foreground"}`}>{uniteAffichee(m.unite)}</span></div>
                        <div className="text-[11px] tabular-nums text-muted-foreground">{m.valeur !== null ? `${m.valeurEstimee ? "≈ " : ""}${usd(m.valeur)}` : "—"}</div>
                      </div>
                      {dateOuverteAuCompte && m.type === "SORTIE" && (
                        <button type="button" onClick={() => { setDateOuverte(dateOuverte === m.id ? null : m.id); setInfo(null); }}
                          aria-expanded={dateOuverte === m.id} aria-label={`Changer la date de la sortie ${m.designation}`} title="Changer la date de cette sortie"
                          className="rounded border px-1.5 py-0.5 text-xs hover:bg-accent">📅</button>
                      )}
                      {estDirection && <SupprimerMouvementBtn id={m.id} />}
                    </div>
                  </div>
                  {dateOuverte === m.id && (
                    <div data-date-sortie={m.id} className="border-t border-dashed bg-muted/30 px-3 py-2">
                      <ChangerDate ids={[m.id]} dateActuelle={m.dateISO} onAnnuler={() => setDateOuverte(null)}
                        onFait={(t, alerte) => { setInfo({ texte: `${m.designation} : ${t}`, alerte }); setDateOuverte(null); }} />
                    </div>
                  )}
                  </div>
                ))}
              </div>
            </details>
          );
        })}
        {mouvements.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted-foreground">Aucun mouvement.</p>}
      </div>
    </div>
  );
}

export function SupprimerMouvementBtn({ id }: { id: string }) {
  const [isPending, start] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      {erreur && <span role="alert" className="text-xs text-destructive">{erreur}</span>}
      <button
        type="button"
        disabled={isPending}
        title="Supprimer ce mouvement (annule son effet sur le stock)"
        onClick={() => {
          if (!confirm("Supprimer ce mouvement ? Son effet sur le stock sera annulé.")) return;
          setErreur(null);
          start(async () => {
            const r = await supprimerMouvement(id);
            if (estErreur(r)) setErreur(r.erreur);
          });
        }}
        className="rounded border px-1.5 py-0.5 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
      >
        ✕
      </button>
    </span>
  );
}

/**
 * Articles choisis d'une sortie « Livraison restaurant » qui n'alimenteront pas le stock du
 * restaurant : avertissement NON BLOQUANT, un conseil et un lien par cas (non rattaché, unité du
 * restaurant ou du catalogue non renseignée, unités incompatibles, à répartir).
 */
function AvertissementLivraison({ ids, articles, conseils }: { ids: string[]; articles: Art[]; conseils: Record<string, ConseilLivraison> }) {
  const noms = new Map(articles.map((a) => [a.id, a.designation]));
  const concernes = [...new Set(ids)].flatMap((id) => (conseils[id] ? [{ id, nom: noms.get(id) ?? id, ...conseils[id]! }] : []));
  if (concernes.length === 0) return null;
  return (
    <div role="status" data-avertissement="livraison" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      <p className="font-medium">Attention : {AVERTISSEMENT_LIVRAISON}.</p>
      <ul className="mt-1 space-y-0.5">
        {concernes.map((c) => (
          <li key={c.id} className="min-w-0 break-words">
            « {c.nom} » — <Link href={c.href} className="font-medium underline">{c.texte}</Link>
          </li>
        ))}
      </ul>
      <p className="mt-1 text-xs">La sortie reste enregistrable : elle retire bien la quantité du dépôt.</p>
    </div>
  );
}

/** Un article proposé à la place d'un article sans stock suffisant (« Utiliser … »). */
type Proche = { id: string; designation: string; unite: string | null; disponible: number };
type LigneSaisie = { articleId: string; quantite: string };
const LIGNES_VIDES = (): LigneSaisie[] => [{ articleId: "", quantite: "" }, { articleId: "", quantite: "" }, { articleId: "", quantite: "" }];
/** Millièmes (Decimal(14,3)) : comparaisons exactes, 0,1 + 0,2 = 0,3. */
const milliemes = (n: number) => Math.round(n * 1000);
/** « 5 kg » ; sans unité : « 5 » ; jamais d'unité inventée. */
export const qteUnite = (n: number, unite: string | null | undefined) => `${qte(n)}${unite?.trim() ? ` ${unite.trim()}` : ""}`;

/**
 * Lignes d'une SORTIE qui dépassent le stock connu de l'écran (2026-10-09 : un stock ne passe jamais
 * sous 0). Les lignes d'un même article s'additionnent. Un article dont l'écran ne connaît pas le stock
 * n'est pas jugé ici : le serveur, sous verrou, a le dernier mot.
 */
export function depassements(lignes: readonly LigneSaisie[], stock: ReadonlyMap<string, number>): Map<string, { disponible: number; demande: number }> {
  const total = new Map<string, number>();
  for (const l of lignes) {
    const q = lireNombreSaisi(l.quantite);
    if (!l.articleId || q === null || q <= 0) continue;
    total.set(l.articleId, (total.get(l.articleId) ?? 0) + milliemes(q));
  }
  const res = new Map<string, { disponible: number; demande: number }>();
  for (const [id, t] of total) {
    const dispo = stock.get(id);
    if (dispo !== undefined && t > milliemes(dispo)) res.set(id, { disponible: dispo, demande: t / 1000 });
  }
  return res;
}

export function MouvementForm({ articles, estDirection = false, conseilsLivraison = {} }: {
  articles: Art[]; estDirection?: boolean;
  /** Articles dont une livraison n'alimenterait pas le restaurant, avec le conseil — calculé par le serveur. */
  conseilsLivraison?: Record<string, ConseilLivraison>;
}) {
  // Lignes CONTRÔLÉES (article + quantité) : le stock disponible s'affiche à côté de la quantité, une
  // sortie qui dépasse est signalée dès la saisie, et « Utiliser … » remplace l'article d'une ligne.
  const [lignes, setLignes] = useState<LigneSaisie[]>(LIGNES_VIDES);
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; texte: string } | null>(null);
  // Une liste d'options pour toutes les lignes : on y cherche par désignation, nom court ou code.
  const optionsArt = useMemo(() => optionsArticles(articles), [articles]);
  const parId = useMemo(() => new Map(articles.map((a) => [a.id, a])), [articles]);
  const stockConnu = useMemo(() => new Map(articles.flatMap((a) => (typeof a.quantite === "number" ? [[a.id, a.quantite] as const] : []))), [articles]);
  const [type, setType] = useState<"ENTREE" | "SORTIE">("ENTREE");
  const [motif, setMotif] = useState<"PERTE" | "LIVRAISON_RESTAURANT" | "">("");
  const [motifEntree, setMotifEntree] = useState<"RETOUR_RESTAURANT" | "">("");
  /** Refus du serveur (stock insuffisant) : par article, les articles proches qui ont du stock. */
  const [refus, setRefus] = useState<Map<string, Proche[]>>(new Map());
  // Depuis le 2026-10-07 (décision de Sacha), toute entrée/sortie manuelle est écrite tout de suite,
  // quel que soit le compte : la Direction en est notifiée, elle ne la valide plus.
  const [ouvert, setOuvert] = useState(false);
  const [cle, setCle] = useState(0);
  const reinitialiser = () => { setLignes(LIGNES_VIDES()); setType("ENTREE"); setMotif(""); setMotifEntree(""); setMotifManquant(false); setMsg(null); setRefus(new Map()); setCle((c) => c + 1); };
  const majLigne = (i: number, l: Partial<LigneSaisie>) => {
    // Une ligne retouchée n'est plus celle que le serveur a refusée : son cadre de refus s'efface.
    const avant = lignes[i]?.articleId;
    if (avant && refus.has(avant)) setRefus((m) => { const n = new Map(m); n.delete(avant); return n; });
    setLignes((ls) => ls.map((x, j) => (j === i ? { ...x, ...l } : x)));
  };

  // Un stock ne passe jamais sous 0 (2026-10-09) : une SORTIE qui dépasse le stock est signalée sur sa
  // ligne et le bouton reste bloqué ; le serveur revérifie sous verrou.
  const depasse = type === "SORTIE" ? depassements(lignes, stockConnu) : new Map<string, { disponible: number; demande: number }>();
  /** Articles proches en stock pour un article qui manque : ceux du refus du serveur, sinon calculés ici. */
  const prochesDe = (id: string): Proche[] => {
    const duServeur = refus.get(id);
    if (duServeur) return duServeur;
    const a = parId.get(id);
    if (!a?.domaine) return [];
    const catalogue = articles.flatMap((x) => (x.domaine && typeof x.quantite === "number" ? [{ ...x, domaine: x.domaine, quantite: x.quantite }] : []));
    return similairesEnStock({ id: a.id, designation: a.designation, domaine: a.domaine }, catalogue).map((p) => ({ id: p.id, designation: p.designation, unite: p.unite ?? null, disponible: p.quantite }));
  };

  // Motif OBLIGATOIRE pour toute sortie (décision du 2026-10-07), pour tous les comptes : refus à
  // l'écran (champ en erreur, rien d'envoyé) ET côté serveur.
  const [motifManquant, setMotifManquant] = useState(false);
  const submit = (fd: FormData) => {
    setMsg(null);
    if (type === "SORTIE" && !String(fd.get("categorieSortie") ?? "")) {
      setMotifManquant(true);
      setMsg({ ok: false, texte: MESSAGE_MOTIF_SORTIE });
      return;
    }
    setMotifManquant(false);
    if (depasse.size > 0) {
      setMsg({ ok: false, texte: "Une ligne dépasse le stock disponible : un stock ne passe jamais sous 0. Corrigez la quantité ou utilisez un article proche." });
      return;
    }
    startTransition(async () => {
      const r = await mouvementManuel(fd);
      if (estErreur(r)) {
        setMsg({ ok: false, texte: r.erreur });
        // Stock insuffisant au moment de l'écriture : les lignes restent, chaque article fautif reçoit ses remplaçants.
        const ins = (r as { insuffisants?: { articleId: string; proches: Proche[] }[] }).insuffisants;
        setRefus(new Map((ins ?? []).map((x) => [x.articleId, x.proches])));
        return;
      }
      setRefus(new Map());
      setLignes(LIGNES_VIDES()); // le formulaire se vide après l'envoi : l'avertissement suit les listes
      setMsg({ ok: true, texte: r?.message ?? (type === "ENTREE" ? "Entrée enregistrée : stock incrémenté." : "Sortie enregistrée : stock décrémenté.") });
    });
  };

  if (!ouvert) return <button onClick={() => setOuvert(true)} className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">± Mouvement manuel (entrée / sortie)</button>;

  return (
    <form key={cle} action={submit} className="space-y-2 rounded-lg border p-4">
      {msg && <p className={`rounded-md border px-3 py-2 text-sm ${msg.ok ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-destructive/40 bg-destructive/10 text-destructive"}`}>{msg.texte}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex overflow-hidden rounded-md border text-sm">
          <button type="button" onClick={() => { setType("ENTREE"); setMotifManquant(false); }} className={`px-3 py-1.5 ${type === "ENTREE" ? "bg-success text-success-foreground" : "hover:bg-accent"}`}>Entrée</button>
          <button type="button" onClick={() => setType("SORTIE")} className={`px-3 py-1.5 ${type === "SORTIE" ? "bg-destructive text-destructive-foreground" : "hover:bg-accent"}`}>Sortie</button>
        </div>
        <input type="hidden" name="type" value={type} />
        {type === "ENTREE" && <span className="text-xs text-muted-foreground">Entrées hors achat (ex. retour restaurant → dépôt). Les achats passent par la Liste d&apos;achat ou une facture.</span>}
        <label className="flex items-center gap-1 text-xs text-muted-foreground">Date<input name="date" type="date" defaultValue={jourCourantKinshasaISO()} className={inp} /></label>
        {type === "SORTIE" ? (
          <label className="flex items-center gap-1 text-xs text-muted-foreground">Motif
            <select name="categorieSortie" value={motif} aria-required aria-invalid={motifManquant || undefined} aria-label="Motif de la sortie (obligatoire)"
              onChange={(e) => { setMotif(e.target.value as typeof motif); if (e.target.value) { setMotifManquant(false); setMsg(null); } }}
              className={`${inp} ${motifManquant ? "border-destructive ring-1 ring-destructive" : ""}`}>
              <option value="">— motif (obligatoire) —</option>
              <option value="LIVRAISON_RESTAURANT">Livraison restaurant</option>
              <option value="PERTE">Perte</option>
            </select>
          </label>
        ) : (
          <>
            <select name="motifEntree" value={motifEntree} onChange={(e) => setMotifEntree(e.target.value as typeof motifEntree)} className={inp} aria-label="Nature de l'entrée">
              <option value="">Autre entrée (correction, don…)</option>
              <option value="RETOUR_RESTAURANT">Retour restaurant</option>
            </select>
            <input name="origine" placeholder="Motif (achat direct, don…)" className={`${inp} min-w-56 flex-1`} />
          </>
        )}
        {type === "SORTIE" && motif === "PERTE" && (
          <input name="raisonSortie" placeholder="Raison de la perte (obligatoire)" required className={`${inp} min-w-56 flex-1`} />
        )}
      </div>

      {type === "SORTIE" && motif === "LIVRAISON_RESTAURANT" && (
        <AvertissementLivraison ids={lignes.map((l) => l.articleId).filter(Boolean)} articles={articles} conseils={conseilsLivraison} />
      )}

      {lignes.map((l, i) => {
        const a = l.articleId ? parId.get(l.articleId) : undefined;
        const dispo = l.articleId ? stockConnu.get(l.articleId) : undefined;
        const trop = l.articleId ? depasse.get(l.articleId) : undefined;
        const refusee = type === "SORTIE" && refus.has(l.articleId);
        const proches = trop || refusee ? prochesDe(l.articleId) : [];
        return (
          <div key={i} data-ligne-mouvement={i} className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <ChoixRecherche options={optionsArt} name="articleId" value={l.articleId} vide="— article —" onChange={(v) => majLigne(i, { articleId: v })} aria-label={`Article, ligne ${i + 1}`} className={`${inp} w-full min-w-64 flex-1`} />
              <ChampNombre name="quantite" value={l.quantite} onChange={(e) => majLigne(i, { quantite: e.target.value })} placeholder="Qté" aria-label={`Quantité, ligne ${i + 1}`} aria-invalid={trop ? true : undefined} alerteMilliers
                className={`${inp} w-28 ${trop ? "border-destructive ring-1 ring-destructive" : ""}`} classeConteneur="w-28" />
              {/* Stock disponible à côté de la quantité, dans l'unité de l'article (jamais inventée). */}
              {l.articleId && dispo !== undefined && (
                <span data-stock-dispo className={`min-w-24 text-xs tabular-nums ${trop ? "font-medium text-destructive" : dispo <= 0 ? "text-destructive" : "text-muted-foreground"}`}>
                  Stock : {qteUnite(dispo, a?.unite)}
                </span>
              )}
            </div>
            {(trop || refusee) && (
              <div role="alert" data-depasse={l.articleId} className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 px-2 py-1.5 text-xs text-destructive">
                <p className="font-medium">
                  {trop
                    ? dispo !== undefined && dispo < 0
                      ? `Stock déjà négatif (${qteUnite(dispo, a?.unite)}) : aucune sortie possible avant sa correction.`
                      : `Dépasse le stock : ${qteUnite(trop.disponible, a?.unite)} disponible${Math.abs(trop.disponible) >= 2 ? "s" : ""}, ${qteUnite(trop.demande, a?.unite)} demandé${trop.demande >= 2 ? "s" : ""}${lignes.filter((x) => x.articleId === l.articleId).length > 1 ? " (toutes les lignes de cet article)" : ""}.`
                    : "Stock insuffisant au moment de l'enregistrement (voir le message ci-dessus)."}
                </p>
                {trop && <p className="text-[11px] text-muted-foreground">Stock lu à l&apos;ouverture de la page : si une entrée vient d&apos;être enregistrée ailleurs, rechargez la page.</p>}
                {proches.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-1.5 text-foreground">
                    <span className="text-muted-foreground">Article{proches.length > 1 ? "s" : ""} proche{proches.length > 1 ? "s" : ""} en stock :</span>
                    {proches.map((p) => (
                      <button key={p.id} type="button" data-utiliser={p.id}
                        onClick={() => { majLigne(i, { articleId: p.id }); setRefus((m) => { const n = new Map(m); n.delete(l.articleId); return n; }); setMsg(null); }}
                        className="rounded-md border bg-background px-2 py-0.5 font-medium hover:bg-accent">
                        Utiliser « {p.designation} » ({qteUnite(p.disponible, p.unite)})
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground">Aucun article proche n&apos;a de stock.</p>
                )}
              </div>
            )}
          </div>
        );
      })}
      <div className="flex flex-wrap items-center gap-3 pt-1">
        <button type="button" onClick={() => setLignes((ls) => [...ls, { articleId: "", quantite: "" }])} className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">+ Ligne</button>
        <button disabled={isPending || depasse.size > 0} title={depasse.size > 0 ? "Une ligne dépasse le stock disponible" : undefined} className={`rounded-md px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50 ${type === "ENTREE" ? "bg-success" : "bg-destructive"}`}>{isPending ? "Enregistrement…" : type === "ENTREE" ? "Valider l'entrée" : "Valider la sortie"}</button>
        <BoutonReinitialiser estDirection={estDirection} onClick={reinitialiser} />
        <button type="button" onClick={() => setOuvert(false)} className="text-sm text-muted-foreground underline">Fermer</button>
      </div>
    </form>
  );
}

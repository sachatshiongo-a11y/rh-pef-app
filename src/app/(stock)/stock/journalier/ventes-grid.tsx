"use client";

import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formaterNombre } from "@/lib/montant";
import { normTexte } from "@/lib/texte";
import { estErreur } from "@/lib/action-lisible";
import { CelluleNombre, type ContexteCase } from "@/components/tableur/cellule-nombre";
import { ZoneTableur } from "@/components/tableur/messages";
import type { EspaceVente, LigneVente } from "@/lib/ventes-journalieres";
import { saisirVente } from "./ventes-actions";
import { rafraichirJournalier } from "./actions";

export type JourVente = { iso: string; label: string; fige: boolean };

const inp = "w-14 rounded border border-input bg-background px-1 py-1 text-center text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-60";
const TITRE_ESPACE: Record<EspaceVente, string> = { CUISINE: "Cuisine — plats vendus", BAR: "Bar — boissons vendues" };
const TOTAL_ESPACE: Record<EspaceVente, string> = { CUISINE: "Total jour — Cuisine", BAR: "Total jour — Bar" };

/** Repos après la dernière case enregistrée avant de revalider la page (une fois pour toute la rafale). */
const REPOS_AVANT_RAFRAICHISSEMENT_MS = 3000;

/** Nombre vendu affiché dans une case de total : « — » quand rien n'est saisi. */
const texteTotal = (t: number | null) => (t === null ? "—" : formaterNombre(t));

/**
 * Saisie des VENTES du restaurant (forme du classeur « Rapport journalier cuisine et bar ») :
 * lignes = unités de vente (fiches « Plat vendu » pour la Cuisine, fiches Bar pour le Bar) par
 * rubrique, colonnes = jours. Un total par espace (jamais plats + boissons). Tableur « comme
 * Excel » (case partagée `CelluleNombre` : Entrée descend, collage d'un bloc Excel).
 * Case vide = pas de saisie (« — ») ; 0 saisi = 0 vendu, enregistré. Un jour de période clôturée
 * est en lecture seule.
 */
export function VentesGrid({ lignes, jours, ventes, peutModifier }: {
  lignes: LigneVente[];
  jours: JourVente[];
  ventes: Record<string, number>;
  peutModifier: boolean;
}) {
  const [q, setQ] = useState("");
  // Valeurs saisies ici (null = saisie retirée), prioritaires sur celles reçues du serveur.
  const [saisies, setSaisies] = useState<Record<string, number | null>>({});
  const [enCours, setEnCours] = useState(0);

  const aRafraichir = useRef(false);
  const minuteur = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const rafraichir = useCallback(() => {
    clearTimeout(minuteur.current);
    if (!aRafraichir.current) return;
    aRafraichir.current = false;
    rafraichirJournalier().catch(() => { aRafraichir.current = true; });
  }, []);
  useEffect(() => () => rafraichir(), [rafraichir]);

  const onEnregistrer = useCallback(async (v: number | null, { ligne, precedente, donnee: iso }: ContexteCase) => {
    if (!iso) throw new Error("Date de la case inconnue.");
    const k = `${ligne}_${iso}`;
    setSaisies((p) => ({ ...p, [k]: v }));
    setEnCours((n) => n + 1);
    clearTimeout(minuteur.current);
    try {
      const r = await saisirVente(ligne, iso, v);
      if (estErreur(r)) throw new Error(r.erreur);
      aRafraichir.current = true;
    } catch (e) {
      setSaisies((p) => ({ ...p, [k]: precedente }));
      throw e;
    } finally {
      setEnCours((n) => n - 1);
      minuteur.current = setTimeout(rafraichir, REPOS_AVANT_RAFRAICHISSEMENT_MS);
    }
  }, [rafraichir]);

  const visibles = useMemo(() => {
    const nq = normTexte(q.trim());
    return nq ? lignes.filter((l) => normTexte(l.designation).includes(nq) || normTexte(l.rubrique).includes(nq)) : lignes;
  }, [lignes, q]);
  const deuxEspaces = new Set(lignes.map((l) => l.espace)).size > 1;

  const valeur = (cle: string, iso: string): number | null => {
    const k = `${cle}_${iso}`;
    const v = k in saisies ? saisies[k] : ventes[k];
    return v ?? null; // 0 reste 0 : « rien vendu » est une saisie
  };
  // Total d'un jour : somme des cases SAISIES ; « — » si aucune ne l'est.
  const totalJour = (iso: string, parmi: LigneVente[]) =>
    parmi.reduce<number | null>((t, l) => { const v = valeur(l.cle, iso); return v === null ? t : (t ?? 0) + v; }, null);

  const nbCol = jours.length + 2;
  const tousFiges = jours.every((j) => j.fige);

  return (
    <div className="space-y-2">
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un plat, une boisson…" className="w-full max-w-xs rounded-md border border-input bg-background px-3 py-1.5 text-sm" />
      <p className="text-xs text-muted-foreground">{visibles.length} / {lignes.length} ligne(s)</p>
      {tousFiges && <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">Période de stock clôturée : les ventes de cette semaine sont en lecture seule.</p>}
      <ZoneTableur>
        <div className="max-h-[70vh] overflow-auto rounded-lg border [scrollbar-gutter:stable]">
          <table data-tableur="" className="w-full min-w-[44rem] border-separate border-spacing-0 text-sm">
            <thead className="sticky top-0 z-20 bg-muted text-left shadow-sm">
              <tr className="[&>th]:border-b [&>th]:px-3 [&>th]:py-2 [&>th]:font-semibold">
                <th className="sticky left-0 z-30 bg-muted">Désignation</th>
                {jours.map((j) => (
                  <th key={j.iso} className="!text-right" title={j.fige ? "Période clôturée : lecture seule" : undefined}>
                    {j.label}{j.fige && <span className="ml-1 text-xs font-normal text-muted-foreground">(clôturé)</span>}
                  </th>
                ))}
                <th className="!text-right">Total</th>
              </tr>
            </thead>
            <tbody className="[&>tr>td]:border-b [&>tr>td]:px-3 [&>tr>td]:py-1.5">
              {visibles.map((l, i) => {
                const prec = visibles[i - 1];
                const suiv = visibles[i + 1];
                const nouvelEspace = deuxEspaces && (!prec || prec.espace !== l.espace);
                const nouvelleRubrique = !prec || prec.espace !== l.espace || prec.rubrique !== l.rubrique;
                const finEspace = !suiv || suiv.espace !== l.espace;
                return (
                  <Fragment key={l.cle}>
                    {nouvelEspace && (
                      <tr><td colSpan={nbCol} className="sticky left-0 !bg-primary/10 !py-2 text-sm font-semibold">{TITRE_ESPACE[l.espace]}</td></tr>
                    )}
                    {nouvelleRubrique && (
                      <tr><td colSpan={nbCol} className="sticky left-0 !bg-amber-100 !py-1.5 text-xs font-bold uppercase tracking-wide text-amber-900">{l.rubrique}</td></tr>
                    )}
                    <LigneVenteGrille l={l} jours={jours} valeurs={jours.map((j) => valeur(l.cle, j.iso))} peutModifier={peutModifier} onEnregistrer={onEnregistrer} />
                    {/* Total PAR ESPACE : additionner des plats et des boissons ne dirait rien. */}
                    {finEspace && (() => {
                      const parmi = visibles.filter((x) => x.espace === l.espace);
                      const totaux = jours.map((j) => totalJour(j.iso, parmi));
                      const semaine = totaux.reduce<number | null>((t, x) => (x === null ? t : (t ?? 0) + x), null);
                      return (
                        <tr className="bg-muted/60 font-semibold [&>td]:!py-2" data-total={l.espace}>
                          <td className="sticky left-0 z-10 bg-muted/60">{TOTAL_ESPACE[l.espace]}</td>
                          {totaux.map((t, k) => <td key={jours[k]!.iso} className="text-right">{texteTotal(t)}</td>)}
                          <td className="text-right">{texteTotal(semaine)}</td>
                        </tr>
                      );
                    })()}
                  </Fragment>
                );
              })}
              {visibles.length === 0 && (
                <tr><td colSpan={nbCol} className="px-3 py-6 text-center text-muted-foreground">{lignes.length === 0 ? "Aucune unité de vente : importez les lignes du classeur, ou créez les fiches techniques (Plat vendu, Bar)." : "Aucune ligne pour cette recherche."}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </ZoneTableur>
      {enCours > 0 && <p className="text-xs text-muted-foreground">Enregistrement…</p>}
    </div>
  );
}

type PropsLigne = {
  l: LigneVente; jours: JourVente[]; valeurs: (number | null)[]; peutModifier: boolean;
  onEnregistrer: (v: number | null, c: ContexteCase) => Promise<void>;
};

// Comparaison PAR VALEURS : un rafraîchissement serveur aux mêmes valeurs ne re-rend aucune ligne.
const memesProps = (p: PropsLigne, n: PropsLigne) =>
  p.l.cle === n.l.cle && p.l.designation === n.l.designation && p.l.inactif === n.l.inactif && p.l.rubrique === n.l.rubrique &&
  p.peutModifier === n.peutModifier && p.onEnregistrer === n.onEnregistrer &&
  p.jours.length === n.jours.length && p.jours.every((j, i) => j.iso === n.jours[i].iso && j.label === n.jours[i].label && j.fige === n.jours[i].fige) &&
  p.valeurs.length === n.valeurs.length && p.valeurs.every((v, i) => v === n.valeurs[i]);

const LigneVenteGrille = memo(function LigneVenteGrille({ l, jours, valeurs, peutModifier, onEnregistrer }: PropsLigne) {
  const saisies = valeurs.filter((v): v is number => v !== null);
  const total = saisies.length ? saisies.reduce((x, y) => x + y, 0) : null;
  return (
    <tr className="even:bg-muted/25 hover:bg-accent/40">
      <td className="sticky left-0 z-10 bg-background font-medium">
        {l.designation}
        {l.inactif && <span className="ml-1.5 text-xs font-normal text-muted-foreground">(désactivé)</span>}
      </td>
      {jours.map((j, i) => (
        <td key={j.iso} className="text-right">
          <CelluleNombre ligne={l.cle} col={i} donnee={j.iso} groupe={`${l.espace}:${l.rubrique}`} valeur={valeurs[i]} onEnregistrer={onEnregistrer} min={0} entier
            disabled={!peutModifier || j.fige} placeholder="—" className={inp} aria-label={`${l.designation} — ${j.label}`} />
        </td>
      ))}
      <td className="text-right font-semibold">{texteTotal(total)}</td>
    </tr>
  );
}, memesProps);

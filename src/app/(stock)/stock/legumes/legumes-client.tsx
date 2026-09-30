"use client";

import { useCallback, useState, useTransition } from "react";
import { creerAchatsLegumes, supprimerAchatLegume } from "./actions";
import { LEGUMES } from "./legumes-data";
import { BoutonReinitialiser } from "../_rapport/bouton-reinitialiser";
import { estErreur } from "@/lib/action-lisible";
import { CelluleNombre } from "@/components/tableur/cellule-nombre";
import { ZoneTableur } from "@/components/tableur/messages";
import { useLigneSuivante } from "@/components/tableur/ligne-suivante";
import { lireSaisieNombre } from "@/lib/nombre";
import { formaterNombre, formaterUSD } from "@/lib/montant";
import { empecherEnvoiParEntree } from "@/lib/entree-sans-envoi";

type Ligne = { legume: string; unite: string; quantite: string; montantCDF: string };
const inp = "rounded border border-input bg-background px-2 py-1 text-sm";
/** Texte de ligne → valeur de case ; valeur de case → texte à POINT (ce que produisait l'ancien champ
 *  number) : ce qui part au serveur (champs quantite / montantCDF) est inchangé. */
const nombreOuNull = (s: string) => { const l = lireSaisieNombre(s); return l.ok ? l.valeur : null; };
const texteDe = (v: number | null) => (v === null ? "" : String(v));
const vide = (): Ligne => ({ legume: "", unite: "", quantite: "", montantCDF: "" });
const NB_LIGNES = 3;

// Même motif que la Liste d'achat (Stock → Achats & mouvements) : UNE seule arborescence, deux
// présentations, suivant la largeur de la LISTE (requête de conteneur) et non celle de l'écran — le
// menu latéral en retire 256 px sur ordinateur.
//  - Liste large (≥ 56 rem) : tableur, UNE rangée par ligne sous un en-tête de colonnes unique.
//  - Sinon (téléphone, tablette) : une carte compacte par ligne, sur 5 pistes :
//      légume (3) · montant CDF · ✕     — rangée 1
//      quantité · unité (2) · ≈ USD (2) — rangée 2
const COLONNES = "@4xl:grid-cols-[minmax(12rem,1fr)_6rem_6rem_8rem_6rem_2rem]";
const PISTES = "grid-cols-[4rem_1rem_4.5rem_minmax(0,1fr)_2.75rem]";
// `order` : l'ordre du DOM est celui du tableur (Tab) ; la carte réordonne à l'œil.
const PLACE = {
  legume: "order-1 col-span-3 @4xl:order-none @4xl:col-span-1",
  unite: "order-5 col-span-2 @4xl:order-none @4xl:col-span-1",
  qte: "order-4 @4xl:order-none",
  montant: "order-2 @4xl:order-none",
  usd: "order-6 col-span-2 @4xl:order-none @4xl:col-span-1",
  retirer: "order-3 @4xl:order-none",
};
// Cibles de 44 px sur la carte ; densité tableur (hauteur naturelle) sur la liste large.
const champ = `${inp} h-11 w-full min-w-0 @4xl:h-auto`;

export function AchatLegumesForm({ taux, estDirection = false }: { taux: number; estDirection?: boolean }) {
  const [isPending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const nouvelles = () => Array.from({ length: NB_LIGNES }, vide);
  const [lignes, setLignes] = useState<Ligne[]>(nouvelles);
  const [cle, setCle] = useState(0);
  const reinitialiser = () => { setMsg(null); setLignes(nouvelles()); setCle((c) => c + 1); };

  // Grille en <div> raccordée à la navigation commune des tableurs (`data-tableur` sur la racine) :
  // Entrée descend à la même colonne de la ligne suivante, et sur la dernière ligne en ajoute une,
  // comme « + Ligne » — sans jamais envoyer le formulaire.
  const ajouterLigne = useCallback(() => setLignes((ls) => [...ls, vide()]), []);
  const { racine, onEntreeDerniereLigne } = useLigneSuivante<HTMLDivElement>(lignes.length, ajouterLigne);

  const maj = (i: number, patch: Partial<Ligne>) => setLignes((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const choisir = (i: number, nom: string) => {
    const l = LEGUMES.find((x) => x.nom === nom);
    maj(i, { legume: nom, unite: l?.unite ?? "" });
  };
  const usdDe = (cdf: string) => (taux && Number(cdf) ? Number(cdf) / taux : 0);
  const totalCDF = lignes.reduce((t, l) => t + (Number(l.montantCDF) || 0), 0);
  const totalUSD = taux ? totalCDF / taux : 0;

  const submit = (fd: FormData) => {
    setMsg(null);
    start(async () => {
      const r = await creerAchatsLegumes(fd);
      if (estErreur(r)) { setMsg({ ok: false, t: r.erreur }); return; }
      setMsg({ ok: true, t: "Achats enregistrés." }); setLignes(nouvelles()); setCle((c) => c + 1);
    });
  };

  return (
    // Entrée n'envoie jamais les achats : seul un clic sur « Enregistrer les achats » les enregistre.
    <form key={cle} action={submit} onKeyDown={empecherEnvoiParEntree} className="space-y-3">
      {msg && <p className={`rounded-md border px-3 py-2 text-sm ${msg.ok ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-destructive/40 bg-destructive/10 text-destructive"}`}>{msg.t}</p>}
      <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Date de l&apos;achat</span>
          <input name="date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} className={inp} />
        </label>
        <span className="pb-1.5 text-xs text-muted-foreground">Taux : 1 USD = {taux ? taux.toLocaleString("fr-FR") : "—"} CDF</span>
      </div>

      {/* Tableur : Entrée descend à la même colonne (et ajoute une ligne en bas) sans envoyer le formulaire ;
          Tab reste celui du navigateur, pour passer aussi par le légume et l'unité. */}
      <ZoneTableur>
        <div className="@container">
          <div ref={racine} data-tableur="" data-tableur-tab="natif" className="space-y-2 @4xl:space-y-0">
            {/* En-têtes de colonnes : UNE fois, liste large seulement (la carte étiquette ses champs par leur texte indicatif). */}
            <div className={`sticky top-0 z-10 hidden gap-1.5 rounded-md bg-muted px-0 py-1.5 text-xs font-medium text-muted-foreground @4xl:grid ${COLONNES}`}>
              <span className="pl-2">Légume</span>
              <span className="pl-2">Unité</span>
              <span className="pr-2 text-right">Quantité</span>
              <span className="pr-2 text-right">Montant CDF</span>
              <span className="pr-2 text-right">≈ USD</span>
              <span className="sr-only">Retirer</span>
            </div>
            {lignes.map((l, i) => (
              <div key={i} data-ligne-achat className={`grid gap-1.5 rounded-lg border p-2 ${PISTES} ${COLONNES} @4xl:items-center @4xl:rounded-none @4xl:border-0 @4xl:border-t @4xl:p-0 @4xl:py-0.5`}>
                <select name="legume" value={l.legume} onChange={(e) => choisir(i, e.target.value)} aria-label={`Légume, ligne ${i + 1}`} className={`${champ} ${PLACE.legume}`}>
                  <option value="">— légume —</option>
                  {LEGUMES.map((x) => <option key={x.nom} value={x.nom}>{x.nom}</option>)}
                </select>
                <input name="unite" value={l.unite} onChange={(e) => maj(i, { unite: e.target.value })} placeholder="Unité" aria-label={`Unité, ligne ${i + 1}`} className={`${champ} ${PLACE.unite}`} />
                {/* Quantité et montant : cases du tableur (sans flèches, Entrée descend). Ce qui part au serveur
                    est le champ caché, à point. */}
                <input type="hidden" name="quantite" value={l.quantite} />
                <CelluleNombre ligne={String(i)} col={0} valeur={nombreOuNull(l.quantite)} onEnregistrer={(v) => maj(i, { quantite: texteDe(v) })} onEntreeDerniereLigne={onEntreeDerniereLigne}
                  min={0} quantite placeholder="Qté" className={`${champ} ${PLACE.qte} text-right`} aria-label={`Quantité, ligne ${i + 1}`} />
                <input type="hidden" name="montantCDF" value={l.montantCDF} />
                <CelluleNombre ligne={String(i)} col={1} valeur={nombreOuNull(l.montantCDF)} onEnregistrer={(v) => maj(i, { montantCDF: texteDe(v) })} onEntreeDerniereLigne={onEntreeDerniereLigne}
                  min={0} placeholder="CDF" title="Montant payé pour la ligne (CDF)"
                  className={`${champ} ${PLACE.montant} text-right font-semibold placeholder:font-normal @4xl:font-normal`} aria-label={`Montant CDF, ligne ${i + 1}`} />
                <span data-usd-ligne className={`${PLACE.usd} self-center pr-2 text-right text-xs tabular-nums text-muted-foreground`}>≈ {formaterUSD(usdDe(l.montantCDF))}</span>
                <button type="button" onClick={() => setLignes((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : ls.map((x, j) => (j === i ? vide() : x))))} aria-label={`Retirer la ligne ${i + 1}`} title="Retirer la ligne"
                  className={`${PLACE.retirer} flex h-11 w-11 items-center justify-center rounded-md border text-sm text-muted-foreground hover:bg-destructive/10 hover:text-destructive @4xl:h-8 @4xl:w-8`}>✕</button>
              </div>
            ))}
          </div>
        </div>
      </ZoneTableur>

      <p className="text-right text-sm">
        <span className="text-muted-foreground">Total : </span>
        <span data-total-cdf className="font-semibold">{formaterNombre(totalCDF)} CDF</span>
        <span data-total-usd className="text-muted-foreground"> ≈ {formaterUSD(totalUSD)}</span>
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={ajouterLigne} className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">+ Ligne</button>
        <button disabled={isPending} className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">{isPending ? "Enregistrement…" : "Enregistrer les achats"}</button>
        <BoutonReinitialiser estDirection={estDirection} onClick={reinitialiser} />
      </div>
    </form>
  );
}

/** Retire une ligne de l'historique des achats de légumes : réservé à la Direction (le serveur exige ADMIN). */
export function SupprimerAchatBtn({ id, legume, estDirection = false }: { id: string; legume?: string; estDirection?: boolean }) {
  const [isPending, start] = useTransition();
  if (!estDirection) return null;
  return (
    <button
      type="button"
      onClick={() => { if (confirm("Supprimer cette ligne ?")) start(async () => { await supprimerAchatLegume(id); }); }}
      disabled={isPending}
      aria-label={legume ? `Supprimer l'achat ${legume}` : "Supprimer cette ligne"}
      title="Supprimer cette ligne"
      className="rounded-md border px-2 py-0.5 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
    >
      ✕
    </button>
  );
}

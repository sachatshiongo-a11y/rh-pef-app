"use client";

import { useState, useTransition } from "react";
import { modifierArticle } from "../actions";
import { estErreur } from "@/lib/action-lisible";
import { CelluleNombre } from "@/components/tableur/cellule-nombre";
import { ZoneTableur } from "@/components/tableur/messages";
import { lireSaisieNombre } from "@/lib/nombre";
import { empecherEnvoiParEntree } from "@/lib/entree-sans-envoi";
import { contenanceDansNom, UNITES_CONTENANCE } from "@/lib/fiches/conversion";

type Cat = { id: string; nom: string; domaine: string };
type Four = { id: string; nom: string };

export type ArticleEdit = {
  id: string;
  domaine: "NOURRITURE" | "BOISSON" | "AUTRE";
  code: string | null;
  designation: string;
  nomCourt: string | null;
  unite: string | null;
  /** Contenance d'une unité comptée à l'unité (« 75 » + « cl ») ; null = inconnue. */
  contenance?: string | null;
  contenanceUnite?: string | null;
  uniteParCarton: string | null;
  prixUnitaireUSD: string | null;
  categorieId: string | null;
  fournisseurId: string | null;
  stockMinimum: string;
  seuilUrgent: string;
};

const inp = "w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm";
/** Texte (venu du serveur) → valeur de case ; l'inverse pour le champ caché envoyé au serveur —
 *  même lecture/écriture que la Liste d'achat de légumes (`legumes-client.tsx`). */
const nombreOuNull = (s: string | null) => { const l = lireSaisieNombre(s ?? ""); return l.ok ? l.valeur : null; };
const texteDe = (v: number | null) => (v === null ? "" : String(v));

/**
 * Bouton « Modifier » de la fiche article, et son formulaire. RÉUTILISE `modifierArticle` (même
 * action, mêmes règles, même journalisation) que la case éditable de l'Inventaire — mêmes droits
 * aussi : cette page est déjà réservée aux comptes du module Stock (`exigerPageStock`), et
 * l'Inventaire ne restreint pas non plus l'édition par rôle ; tout compte qui voit la fiche peut
 * donc déjà modifier l'article dans Inventaire, ce bouton ne fait qu'ouvrir les mêmes champs ici.
 *
 * N'envoie JAMAIS `quantite` : le stock ne se modifie que par un mouvement, l'inventaire (comptage)
 * ou la correction de stock négatif — jamais par ce formulaire.
 */
export function EditerArticle({ a, categories, fournisseurs, estDirection = true }: { a: ArticleEdit; categories: Cat[]; fournisseurs: Four[]; estDirection?: boolean }) {
  const [ouvert, setOuvert] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null); // proposition envoyée (hors Direction)
  const [isPending, start] = useTransition();
  // Cases numériques : valeur tenue en state (texte), portée par un champ caché du même nom que
  // lit `modifierArticle` — comme les lignes de la Liste d'achat de légumes.
  const [prix, setPrix] = useState(a.prixUnitaireUSD ?? "");
  const [parCarton, setParCarton] = useState(a.uniteParCarton ?? "");
  const [contenance, setContenance] = useState(a.contenance ?? "");
  const lue = contenanceDansNom(a.designation);
  const [seuilMin, setSeuilMin] = useState(a.stockMinimum);
  const [seuilUrgent, setSeuilUrgent] = useState(a.seuilUrgent);
  // Catégories du domaine de l'article — PLUS sa catégorie actuelle si elle est d'un autre domaine
  // (import, reclassement) : absente de la liste, le select retomberait sur « à classer » et
  // l'enregistrement effacerait la catégorie sans que personne l'ait demandé.
  const catsPour = categories.filter((c) => c.domaine === a.domaine || c.id === a.categorieId);

  const enregistrer = (fd: FormData) => {
    setErreur(null);
    start(async () => {
      const r = await modifierArticle(a.id, fd);
      if (estErreur(r)) { setErreur(r.erreur); return; }
      if (r && "message" in r) setInfo(r.message);
      setOuvert(false);
    });
  };

  if (!ouvert) {
    // Hors Direction : on PROPOSE une modification (la Direction la valide ou la refuse).
    return (
      <>
        <button onClick={() => { setInfo(null); setOuvert(true); }} className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">{estDirection ? "Modifier" : "Proposer une modification"}</button>
        {info && <p className="w-full rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">{info}</p>}
      </>
    );
  }

  return (
    <form action={enregistrer} onKeyDown={empecherEnvoiParEntree} className="w-full rounded-xl border bg-muted/20 p-4">
      {erreur && <p className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erreur}</p>}
      <ZoneTableur>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">Désignation *
            <input name="designation" defaultValue={a.designation} required className={inp} />
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">Nom court (fiche Commande journalière)
            <input name="nomCourt" defaultValue={a.nomCourt ?? ""} placeholder="ex. Carré d'agneau" className={inp} />
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">Code article
            <input name="code" defaultValue={a.code ?? ""} placeholder="ex. 137" className={inp} />
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">Unité
            <input name="unite" defaultValue={a.unite ?? ""} placeholder="Kg, Pièce…" className={inp} />
          </label>
          <div className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
            <span>Contenance d&apos;une unité (bouteille, pièce…)</span>
            <div className="flex gap-1">
              <input type="hidden" name="contenance" value={contenance} />
              <CelluleNombre ligne="article" col={4} valeur={nombreOuNull(contenance)} onEnregistrer={(v) => setContenance(texteDe(v))} min={0} quantite
                placeholder={lue ? `lu dans le nom : ${lue.quantite.toString()}` : "ex. 75"} className={`${inp} text-right`} aria-label="Contenance" />
              <select name="contenanceUnite" defaultValue={a.contenanceUnite ?? ""} className={`${inp} w-20`} aria-label="Unité de contenance">
                <option value="">—</option>
                {UNITES_CONTENANCE.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <span className="text-[11px]">Sert au coût des fiches consommées en cl ou en g{lue && !a.contenance ? ` — le nom indique ${lue.quantite.toString()} ${lue.unite}` : ""}.</span>
          </div>
          <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">Unités / carton
            <input type="hidden" name="uniteParCarton" value={parCarton} />
            <CelluleNombre ligne="article" col={0} valeur={nombreOuNull(parCarton)} onEnregistrer={(v) => setParCarton(texteDe(v))} min={0} quantite placeholder="ex. 24" className={`${inp} text-right`} aria-label="Unités par carton" />
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">Prix unitaire USD
            <input type="hidden" name="prixUnitaireUSD" value={prix} />
            <CelluleNombre ligne="article" col={1} valeur={nombreOuNull(prix)} onEnregistrer={(v) => setPrix(texteDe(v))} min={0} className={`${inp} text-right`} aria-label="Prix unitaire USD" />
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">Catégorie
            <select name="categorieId" defaultValue={a.categorieId ?? ""} className={inp}>
              <option value="">— à classer —</option>
              {catsPour.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
            </select>
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">Fournisseur
            <select name="fournisseurId" defaultValue={a.fournisseurId ?? ""} className={inp}>
              <option value="">—</option>
              {fournisseurs.map((f) => <option key={f.id} value={f.id}>{f.nom}</option>)}
            </select>
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">Stock minimum
            <input type="hidden" name="stockMinimum" value={seuilMin} />
            <CelluleNombre ligne="article" col={2} valeur={nombreOuNull(seuilMin)} onEnregistrer={(v) => setSeuilMin(texteDe(v))} min={0} quantite className={`${inp} text-right`} aria-label="Stock minimum" />
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">Seuil urgent
            <input type="hidden" name="seuilUrgent" value={seuilUrgent} />
            <CelluleNombre ligne="article" col={3} valeur={nombreOuNull(seuilUrgent)} onEnregistrer={(v) => setSeuilUrgent(texteDe(v))} min={0} quantite className={`${inp} text-right`} aria-label="Seuil urgent" />
          </label>
        </div>
      </ZoneTableur>
      <p className="mt-2 text-xs text-muted-foreground">Le stock ne se modifie pas ici : il évolue par les mouvements, l&apos;inventaire (comptage) ou la correction d&apos;un stock négatif.</p>
      {!estDirection && <p className="mt-1 text-xs text-amber-800">Seuls les champs changés sont proposés ; l&apos;article ne change qu&apos;après validation de la Direction.</p>}
      <div className="mt-3 flex items-center gap-2">
        <button disabled={isPending} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">{isPending ? "Enregistrement…" : estDirection ? "Enregistrer" : "Envoyer à la Direction"}</button>
        <button type="button" onClick={() => setOuvert(false)} className="text-sm text-muted-foreground underline">Annuler</button>
      </div>
    </form>
  );
}

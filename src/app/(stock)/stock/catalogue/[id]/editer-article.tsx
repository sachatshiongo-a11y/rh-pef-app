"use client";

import { useState, useTransition } from "react";
import { modifierArticle } from "../actions";
import { estErreur } from "@/lib/action-lisible";
import { CelluleNombre } from "@/components/tableur/cellule-nombre";
import { ZoneTableur } from "@/components/tableur/messages";
import { lireSaisieNombre } from "@/lib/nombre";
import { empecherEnvoiParEntree } from "@/lib/entree-sans-envoi";

type Cat = { id: string; nom: string; domaine: string };
type Four = { id: string; nom: string };

export type ArticleEdit = {
  id: string;
  domaine: "NOURRITURE" | "BOISSON" | "AUTRE";
  code: string | null;
  designation: string;
  unite: string | null;
  uniteParCarton: string | null;
  prixUnitaireUSD: string | null;
  categorieId: string | null;
  fournisseurId: string | null;
  stockMinimum: string;
  seuilUrgent: string;
};

const inp = "w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm";
/** Texte (venu du serveur) → valeur de case ; l'inverse pour le champ cadhé envoyé au serveur —
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
export function EditerArticle({ a, categories, fournisseurs }: { a: ArticleEdit; categories: Cat[]; fournisseurs: Four[] }) {
  const [ouvert, setOuvert] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [isPending, start] = useTransition();
  // Cases numériques : valeur tenue en state (texte), portée par un champ caché du même nom que
  // lit `modifierArticle` — comme les lignes de la Liste d'achat de légumes.
  const [prix, setPrix] = useState(a.prixUnitaireUSD ?? "");
  const [parCarton, setParCarton] = useState(a.uniteParCarton ?? "");
  const [seuilMin, setSeuilMin] = useState(a.stockMinimum);
  const [seuilUrgent, setSeuilUrgent] = useState(a.seuilUrgent);
  const catsPour = categories.filter((c) => c.domaine === a.domaine);

  const enregistrer = (fd: FormData) => {
    setErreur(null);
    start(async () => {
      const r = await modifierArticle(a.id, fd);
      if (estErreur(r)) { setErreur(r.erreur); return; }
      setOuvert(false);
    });
  };

  if (!ouvert) {
    return <button onClick={() => setOuvert(true)} className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">Modifier</button>;
  }

  return (
    <form action={enregistrer} onKeyDown={empecherEnvoiParEntree} className="w-full rounded-xl border bg-muted/20 p-4">
      {erreur && <p className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erreur}</p>}
      <ZoneTableur>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">Désignation *
            <input name="designation" defaultValue={a.designation} required className={inp} />
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">Code article
            <input name="code" defaultValue={a.code ?? ""} placeholder="ex. 137" className={inp} />
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">Unité
            <input name="unite" defaultValue={a.unite ?? ""} placeholder="Kg, Pièce…" className={inp} />
          </label>
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
      <div className="mt-3 flex items-center gap-2">
        <button disabled={isPending} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">{isPending ? "Enregistrement…" : "Enregistrer"}</button>
        <button type="button" onClick={() => setOuvert(false)} className="text-sm text-muted-foreground underline">Annuler</button>
      </div>
    </form>
  );
}

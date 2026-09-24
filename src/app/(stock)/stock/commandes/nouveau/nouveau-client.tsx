"use client";

import { useCallback, useState, useTransition } from "react";
import { creerBonCommande, modifierBonCommande } from "../actions";
import { estErreur } from "@/lib/action-lisible";
import { CelluleNombre } from "@/components/tableur/cellule-nombre";
import { useLigneSuivante } from "@/components/tableur/ligne-suivante";
import { ZoneTableur } from "@/components/tableur/messages";
import { lireSaisieNombre } from "@/lib/nombre";
import { empecherEnvoiParEntree } from "@/lib/entree-sans-envoi";

/** Texte de ligne → valeur de case (« 12.500 » reçu du serveur → 12,5 affiché). */
const nombreOuNull = (s: string) => { const l = lireSaisieNombre(s); return l.ok ? l.valeur : null; };
/**
 * Valeur de case → texte de ligne : écriture à POINT (« 2.5 »), celle que produisait l'ancien
 * champ number. Les montants (`Number(l.quantite) * Number(l.prix)`) et ce qui part au serveur
 * (champs cachés ligne_quantite / ligne_prix) sont donc inchangés, virgule tapée ou non.
 */
const texteDe = (v: number | null) => (v === null ? "" : String(v));

type Art = { id: string; designation: string; prix: string | null; uniteParCarton: string | null };
type Four = { id: string; nom: string };
type Ligne = { articleId: string; designation: string; quantite: string; prix: string; uniteParCarton: string };
export type BonInitial = {
  bcId: string; fournisseurId: string | null; delaiPaiement: string; modePaiement: string; commentaire: string;
  lignes: Ligne[];
};

const inp = "rounded border border-input bg-background px-2 py-1 text-sm";
const vide = (): Ligne => ({ articleId: "", designation: "", quantite: "", prix: "", uniteParCarton: "" });

export function NouveauBonForm({ articles, fournisseurs, initial, estDirection = false }: { articles: Art[]; fournisseurs: Four[]; initial?: BonInitial; estDirection?: boolean }) {
  const [lignes, setLignes] = useState<Ligne[]>(initial?.lignes.length ? initial.lignes : [vide(), vide(), vide()]);
  const action = initial ? modifierBonCommande.bind(null, initial.bcId) : creerBonCommande;
  const [erreur, setErreur] = useState<string | null>(null);
  const [isPending, start] = useTransition();
  // Le succès redirige (exception interne de Next, laissée passer) ; une erreur métier revient
  // en { erreur } lisible et s'affiche sous le formulaire.
  const submit = (fd: FormData) => {
    setErreur(null);
    start(async () => {
      let r: Awaited<ReturnType<typeof action>>;
      try { r = await action(fd); } catch { return; }
      if (estErreur(r)) setErreur(r.erreur);
    });
  };

  const maj = (i: number, patch: Partial<Ligne>) => setLignes((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const ajouterLigne = useCallback(() => setLignes((ls) => [...ls, vide()]), []);
  const { racine, onEntreeDerniereLigne } = useLigneSuivante(lignes.length, ajouterLigne);
  const choisirArticle = (i: number, articleId: string) => {
    const a = articles.find((x) => x.id === articleId);
    maj(i, { articleId, designation: a ? a.designation : "", prix: a?.prix ?? "", uniteParCarton: a?.uniteParCarton ?? "" });
  };
  const total = lignes.reduce((t, l) => t + (Number(l.quantite) || 0) * (Number(l.prix) || 0), 0);

  return (
    // Entrée n'envoie jamais le bon : seul un clic sur le bouton l'enregistre.
    <form action={submit} onKeyDown={empecherEnvoiParEntree} className="space-y-4">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Fournisseur</span>
          <select name="fournisseurId" defaultValue={initial?.fournisseurId ?? ""} className={inp}>
            <option value="">— fournisseur —</option>
            {fournisseurs.map((f) => <option key={f.id} value={f.id}>{f.nom}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Délai de paiement</span>
          <input name="delaiPaiement" defaultValue={initial?.delaiPaiement ?? ""} className={inp} placeholder="ex. 30 jours" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Mode de paiement</span>
          <input name="modePaiement" defaultValue={initial?.modePaiement ?? ""} className={inp} placeholder="ex. Espèces" />
        </label>
      </div>

      <ZoneTableur>
      <div className="max-h-[70vh] overflow-auto rounded-lg border">
        {/* Tableur : Entrée descend (et ajoute une ligne en bas) sans envoyer le bon ; Tab reste celui
            du navigateur, pour passer aussi par l'article et la désignation. */}
        <table ref={racine} data-tableur="" data-tableur-tab="natif" className="w-full min-w-[48rem] text-sm">
          <thead className="sticky top-0 z-10 bg-muted text-left">
            <tr>
              <th className="px-2 py-2">Article (catalogue)</th>
              <th className="px-2 py-2">Désignation</th>
              <th className="px-2 py-2 text-right">Quantité</th>
              <th className="px-2 py-2 text-right" title="Calculé : quantité ÷ unités par carton (défini au catalogue)">Cartons</th>
              <th className="px-2 py-2 text-right">P.U. USD</th>
              <th className="px-2 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {lignes.map((l, i) => (
              <tr key={i} className="border-t">
                <td className="px-2 py-1">
                  <select value={l.articleId} onChange={(e) => choisirArticle(i, e.target.value)} className={`${inp} min-w-48`}>
                    <option value="">— libre —</option>
                    {articles.map((a) => <option key={a.id} value={a.id}>{a.designation}</option>)}
                  </select>
                  <input type="hidden" name="ligne_articleId" value={l.articleId} />
                  <input type="hidden" name="ligne_uniteParCarton" value={l.uniteParCarton} />
                </td>
                <td className="px-2 py-1"><input name="ligne_designation" value={l.designation} onChange={(e) => maj(i, { designation: e.target.value })} className={`${inp} w-full`} placeholder="Désignation" /></td>
                <td className="px-2 py-1">
                  <input type="hidden" name="ligne_quantite" value={l.quantite} />
                  <CelluleNombre ligne={String(i)} col={0} valeur={nombreOuNull(l.quantite)} onEnregistrer={(v) => maj(i, { quantite: texteDe(v) })}
                    onEntreeDerniereLigne={onEntreeDerniereLigne} min={0} quantite className={`${inp} w-24 text-right`} aria-label={`Quantité, ligne ${i + 1}`} />
                </td>
                <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">
                  {(() => {
                    const upc = Number(l.uniteParCarton) || 0, q = Number(l.quantite) || 0;
                    if (upc <= 0 || q <= 0) return "—";
                    const c = q / upc;
                    return Number.isInteger(c) ? `${c}` : c.toFixed(2).replace(".", ",");
                  })()}
                </td>
                <td className="px-2 py-1">
                  <input type="hidden" name="ligne_prix" value={l.prix} />
                  <CelluleNombre
                    ligne={String(i)} col={1} valeur={nombreOuNull(l.prix)} onEnregistrer={(v) => maj(i, { prix: texteDe(v) })}
                    onEntreeDerniereLigne={onEntreeDerniereLigne}
                    readOnly={!!l.articleId}
                    title={l.articleId ? "Prix fixé au catalogue (modifiable dans l'onglet Catalogue)" : "Prix libre"}
                    min={0}
                    className={`${inp} w-24 text-right ${l.articleId ? "bg-muted/50 text-muted-foreground" : ""}`}
                    aria-label={`Prix unitaire, ligne ${i + 1}`}
                  />
                </td>
                <td className="px-2 py-1 text-right text-muted-foreground">{((Number(l.quantite) || 0) * (Number(l.prix) || 0)).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </ZoneTableur>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={ajouterLigne} className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">+ Ligne</button>
        <div className="text-right">
          <span className="text-sm text-muted-foreground">Total : </span>
          <span className="text-lg font-semibold">{total.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $</span>
        </div>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-muted-foreground">Note (optionnel)</span>
        <textarea name="commentaire" defaultValue={initial?.commentaire ?? ""} rows={2} className={`${inp} w-full`} />
      </label>

      {/* Direction : le bon naît validé — sauf si l'on choisit de le garder en brouillon. */}
      {!initial && estDirection && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="enregistrerBrouillon" />
          <span>Enregistrer comme <strong>brouillon</strong> (ne pas valider tout de suite)</span>
        </label>
      )}

      {erreur && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erreur}</p>}
      <button type="submit" disabled={isPending} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">{isPending ? "…" : initial ? "Enregistrer les modifications" : "Créer le bon de commande"}</button>
    </form>
  );
}

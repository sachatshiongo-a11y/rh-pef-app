"use client";

import { useState } from "react";
import { creerBonCommande, modifierBonCommande } from "../actions";

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

  const maj = (i: number, patch: Partial<Ligne>) => setLignes((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const choisirArticle = (i: number, articleId: string) => {
    const a = articles.find((x) => x.id === articleId);
    maj(i, { articleId, designation: a ? a.designation : "", prix: a?.prix ?? "", uniteParCarton: a?.uniteParCarton ?? "" });
  };
  const total = lignes.reduce((t, l) => t + (Number(l.quantite) || 0) * (Number(l.prix) || 0), 0);

  return (
    <form action={action} className="space-y-4">
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

      <div className="max-h-[70vh] overflow-auto rounded-lg border">
        <table className="w-full min-w-[48rem] text-sm">
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
                <td className="px-2 py-1"><input name="ligne_quantite" value={l.quantite} onChange={(e) => maj(i, { quantite: e.target.value })} type="number" step="0.001" min="0" className={`${inp} w-24 text-right`} /></td>
                <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">
                  {(() => {
                    const upc = Number(l.uniteParCarton) || 0, q = Number(l.quantite) || 0;
                    if (upc <= 0 || q <= 0) return "—";
                    const c = q / upc;
                    return Number.isInteger(c) ? `${c}` : c.toFixed(2).replace(".", ",");
                  })()}
                </td>
                <td className="px-2 py-1">
                  <input
                    name="ligne_prix"
                    value={l.prix}
                    onChange={(e) => maj(i, { prix: e.target.value })}
                    readOnly={!!l.articleId}
                    title={l.articleId ? "Prix fixé au catalogue (modifiable dans l'onglet Catalogue)" : "Prix libre"}
                    type="number"
                    step="0.0001"
                    min="0"
                    className={`${inp} w-24 text-right ${l.articleId ? "bg-muted/50 text-muted-foreground" : ""}`}
                  />
                </td>
                <td className="px-2 py-1 text-right text-muted-foreground">{((Number(l.quantite) || 0) * (Number(l.prix) || 0)).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={() => setLignes((ls) => [...ls, vide()])} className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">+ Ligne</button>
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

      <button className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">{initial ? "Enregistrer les modifications" : "Créer le bon de commande"}</button>
    </form>
  );
}

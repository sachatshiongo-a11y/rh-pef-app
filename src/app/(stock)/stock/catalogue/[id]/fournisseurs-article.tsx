"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { BulkBar, useBulkSelection } from "@/components/bulk-bar";
import { BoutonDanger, BoutonNeutre, BoutonValider } from "@/components/action-buttons";
import { ChoixRecherche } from "@/components/choix-recherche";
import { estErreur } from "@/lib/action-lisible";
import { jjmmaaaa } from "@/lib/achats-liste";
import { formaterPrix, type DevisePrix } from "@/lib/prix-article";
import { LIBELLE_ORIGINE, type ComparaisonPrix, type OriginePrix } from "@/lib/prix-fournisseurs";
import { optionsFournisseurs } from "@/lib/recherche-options";
import { ajouterFournisseursArticle, definirFournisseurHabituel, retirerFournisseursArticle } from "../actions";

/** Le dernier prix d'un fournisseur, tel que le serveur le calcule (dates en AAAA-MM-JJ, montants en texte exact). */
export type PrixLigne = {
  devise: DevisePrix;
  /** Par unité de l'article, dans la devise de saisie ; null = unité non convertible. */
  prix: string | null;
  prixSaisi: string;
  uniteLigne: string | null;
  motif: string | null;
  date: string;
  origine: OriginePrix;
  refId: string | null;
  refLibelle: string | null;
  autre: { devise: DevisePrix; valeur: number } | null;
  moinsCher: boolean;
  ecartPct: number | null;
  nbAchats: number;
};
export type LigneFournisseurArticle = { fournisseurId: string; nom: string; habituel: boolean; prix: PrixLigne | null };

const NOTE: Record<ComparaisonPrix["etat"], string> = {
  AUCUN: "Aucun achat chiffré chez ces fournisseurs : le prix apparaîtra à la prochaine facture, au prochain achat de la Liste d'achat ou au prochain bon de commande.",
  UN_SEUL: "Un seul fournisseur a un prix : rien à comparer pour l'instant.",
  DEVISES_SANS_TAUX: "Ces prix sont dans des devises différentes et le taux du jour n'est pas défini (Paramètres) : la comparaison est impossible, jamais supposée.",
  COMPARE: "Prix ramenés à l'unité de l'article. « ≈ » : converti au taux du jour, pour comparer seulement.",
};

function Origine({ p }: { p: PrixLigne }) {
  const libelle = p.origine === "FACTURE" ? `Facture${p.refLibelle ? ` n° ${p.refLibelle}` : ""}` : p.origine === "BON_COMMANDE" ? `Bon ${p.refLibelle ?? ""}`.trim() : LIBELLE_ORIGINE.LISTE_ACHAT;
  if (p.origine === "FACTURE" && p.refId) return <Link href={`/stock/factures/${p.refId}`} className="text-primary hover:underline">{libelle}</Link>;
  if (p.origine === "BON_COMMANDE" && p.refId) return <Link href={`/stock/commandes/${p.refId}`} className="text-primary hover:underline">{libelle}</Link>;
  return <span className="text-muted-foreground">{libelle}</span>;
}

/**
 * Les fournisseurs d'un article (2026-10-16) : la liste complète, le fournisseur HABITUEL marqué, et pour chacun son
 * DERNIER PRIX d'achat (devise de saisie, « ≈ » dans l'autre), sa date et son origine, ramené à l'unité de l'article,
 * pour comparer qui est le moins cher. Actions groupées comme partout : cases + barre (« Définir comme habituel »,
 * « Retirer »). Direction : écriture directe ; autre rôle : proposition « À valider ».
 */
export function FournisseursArticle({ articleId, unite, lignes, autres, etat, estDirection }: {
  articleId: string; unite: string | null; lignes: LigneFournisseurArticle[]; autres: { id: string; nom: string }[]; etat: ComparaisonPrix["etat"]; estDirection: boolean;
}) {
  const { sel, toggle, clear, setAll } = useBulkSelection();
  const [isPending, start] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null); // proposition envoyée (ambre)
  const [fait, setFait] = useState<string | null>(null); // geste fait (vert)
  const [aAjouter, setAAjouter] = useState("");
  const optionsAutres = useMemo(() => optionsFournisseurs(autres), [autres]);
  const choisis = lignes.filter((l) => sel.has(l.fournisseurId));
  const uniteTxt = unite?.trim() ? unite.trim() : "unité";

  const lancer = (fn: () => Promise<unknown>) => {
    setErreur(null); setInfo(null); setFait(null);
    start(async () => {
      const r = await fn();
      if (estErreur(r)) { setErreur(r.erreur); return; }
      const rep = r as { proposition?: boolean; message?: string } | null;
      if (rep && typeof rep === "object" && typeof rep.message === "string") {
        if (rep.proposition) setInfo(rep.message); else setFait(rep.message);
      }
      clear();
      setAAjouter("");
    });
  };
  const habituelChoisi = choisis.length === 1 && !choisis[0]!.habituel ? choisis[0]! : null;

  return (
    <section id="fournisseurs" data-fournisseurs-article className="space-y-3 rounded-xl border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold">Fournisseurs ({lignes.length})</h2>
        <span className="text-xs text-muted-foreground">Le dernier prix est calculé depuis les achats, factures et bons de commande : il suit leurs corrections.</span>
      </div>
      {erreur && <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erreur}</p>}
      {info && <p role="status" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">{info}</p>}
      {fait && <p role="status" className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{fait}</p>}

      {lignes.length > 0 && (
        <BulkBar count={sel.size} total={lignes.length} onAll={(on) => setAll(lignes.map((l) => l.fournisseurId), on)}>
          <BoutonValider type="button" disabled={isPending || habituelChoisi === null} title="Un seul fournisseur à la fois, qui n'est pas déjà l'habituel" onClick={() => lancer(() => definirFournisseurHabituel(articleId, habituelChoisi!.fournisseurId))}>
            {estDirection ? "Définir comme habituel" : "Proposer comme habituel"}
          </BoutonValider>
          <BoutonDanger type="button" disabled={isPending || choisis.length === 0} title="Retire de la liste de l'article (s'il était l'habituel, l'article reste sans habituel)" onClick={() => {
            if (!window.confirm(`${estDirection ? "Retirer" : "Proposer de retirer"} ${choisis.map((c) => c.nom).join(", ")} des fournisseurs de cet article ?`)) return;
            lancer(() => retirerFournisseursArticle(articleId, choisis.map((c) => c.fournisseurId)));
          }}>
            {estDirection ? "Retirer" : "Proposer le retrait"} ({choisis.length})
          </BoutonDanger>
          <BoutonNeutre type="button" disabled={isPending} onClick={clear}>Désélectionner</BoutonNeutre>
        </BulkBar>
      )}

      {lignes.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aucun fournisseur pour cet article. Il s&apos;ajoute tout seul dès qu&apos;un achat de la Liste d&apos;achat, une facture ou un bon de commande le mentionne ; ou ajoutez-le ci-dessous.</p>
      ) : (
        <div className="tableau-normal rounded-lg border">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="bg-muted text-left text-xs text-muted-foreground">
              <tr>
                <th className="w-8 px-2 py-2" />
                <th className="px-2 py-2 font-medium">Fournisseur</th>
                <th className="px-2 py-2 text-right font-medium">Dernier prix / {uniteTxt}</th>
                <th className="px-2 py-2 font-medium">Date</th>
                <th className="px-2 py-2 font-medium">Origine</th>
                <th className="px-2 py-2 font-medium">Comparaison</th>
              </tr>
            </thead>
            <tbody>
              {lignes.map((l) => {
                const p = l.prix;
                return (
                  <tr key={l.fournisseurId} data-fournisseur={l.fournisseurId} className={`border-t ${sel.has(l.fournisseurId) ? "bg-primary/10" : ""}`}>
                    <td className="px-2 py-2"><input type="checkbox" checked={sel.has(l.fournisseurId)} onChange={() => toggle(l.fournisseurId)} aria-label={`Sélectionner ${l.nom}`} /></td>
                    <td className="px-2 py-2">
                      <Link href={`/stock/fournisseurs/${l.fournisseurId}`} className="font-medium text-primary hover:underline">{l.nom}</Link>
                      {l.habituel && <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">Habituel</span>}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {p === null ? <span className="text-muted-foreground" title="Aucun achat chiffré chez ce fournisseur">—</span>
                        : p.prix === null ? (
                          <span className="text-amber-800" title={p.motif ?? undefined}>{formaterPrix(Number(p.prixSaisi), p.devise)}{p.uniteLigne ? ` / ${p.uniteLigne}` : ""}</span>
                        ) : (
                          <>
                            <span className="font-medium">{formaterPrix(Number(p.prix), p.devise)}</span>
                            {p.autre && <span className="block text-[11px] text-muted-foreground">≈ {formaterPrix(p.autre.valeur, p.autre.devise)}</span>}
                          </>
                        )}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-muted-foreground">{p ? jjmmaaaa(p.date) : "—"}</td>
                    <td className="px-2 py-2">{p ? <Origine p={p} /> : <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-2 py-2">
                      {p === null ? null : p.prix === null ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800" title={p.motif ?? undefined}>Unité non comparable</span>
                      ) : p.moinsCher ? (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">Moins cher</span>
                      ) : p.ecartPct !== null ? (
                        <span className="text-xs tabular-nums text-red-700">+{Math.round(p.ecartPct * 10) / 10} %</span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {lignes.length > 0 && <p data-note-prix className="text-xs text-muted-foreground">{NOTE[etat]}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">Ajouter un fournisseur :</span>
        <div className="w-60">
          <ChoixRecherche options={optionsAutres} value={aAjouter} vide="Choisir un fournisseur…" onChange={setAAjouter} aria-label="Fournisseur à ajouter à l'article" className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm" />
        </div>
        <BoutonNeutre type="button" disabled={isPending || !aAjouter} onClick={() => lancer(() => ajouterFournisseursArticle(articleId, [aAjouter]))}>{estDirection ? "Ajouter" : "Proposer l'ajout"}</BoutonNeutre>
      </div>
    </section>
  );
}

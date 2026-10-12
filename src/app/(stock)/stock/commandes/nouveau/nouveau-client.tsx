"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { creerBonCommande, modifierBonCommande } from "../actions";
import { estErreur } from "@/lib/action-lisible";
import { CelluleNombre } from "@/components/tableur/cellule-nombre";
import { useLigneSuivante } from "@/components/tableur/ligne-suivante";
import { ZoneTableur } from "@/components/tableur/messages";
import { ecrireSaisieNombre, lireSaisieNombre } from "@/lib/nombre";
import { canoniqueVersSaisie, nombreDeSaisie } from "@/lib/saisie-nombre-stock";
import { empecherEnvoiParEntree } from "@/lib/entree-sans-envoi";
import { ChoixRecherche } from "@/components/choix-recherche";
import { optionsArticles } from "@/lib/recherche-options";
import { liensParArticle, optionsFournisseursPourArticles } from "@/lib/fournisseurs-article";
import { formaterMontantFacture, libelleAutreDevise } from "@/lib/facture-devise";

/** Texte de ligne → valeur de case (« 12.500 » reçu du serveur → 12,5 affiché). */
const nombreOuNull = (s: string) => { const l = lireSaisieNombre(s); return l.ok ? l.valeur : null; };
/**
 * Valeur de case → texte de ligne : écriture à la FRANÇAISE (« 2,5 »), relisible par `nombreOuNull`
 * et par le serveur (champs cachés ligne_quantite / ligne_prix lus par `decSaisi`). Les montants
 * se calculent par `nombreDeSaisie`, jamais par `Number()` (qui lirait « 2,5 » comme NaN).
 */
const texteDe = (v: number | null) => (v === null ? "" : ecrireSaisieNombre(v));

/**
 * Prix catalogue PROPOSÉS dans chaque devise du bon (2026-10-16 : bon en $ ou en FC) : `prix` en dollars, `prixCDF` en
 * francs — exact dans la devise du prix de référence de l'article (`refDevise`), converti au taux du jour dans l'autre
 * (annoncé « ≈ » sous la case) ; vide sans prix ou sans taux. `prixFC` : « 7 000 FC » si le prix de référence est en
 * francs ; `prixRef` : le prix de référence formaté dans sa devise.
 */
type Devise = "USD" | "CDF";
type Art = { id: string; designation: string; contenance?: string | null; contenanceUnite?: string | null; nomCourt?: string | null; code?: string | null; prix: string | null; prixCDF?: string | null; prixFC?: string | null; refDevise?: Devise | null; prixRef?: string | null; uniteParCarton: string | null };
type Four = { id: string; nom: string };
type Ligne = { articleId: string; designation: string; quantite: string; prix: string; uniteParCarton: string };
export type BonInitial = {
  bcId: string; fournisseurId: string | null; /** Devise du bon (absente = dollars). */ devise?: Devise; delaiPaiement: string; modePaiement: string; commentaire: string;
  lignes: Ligne[];
};

const inp = "rounded border border-input bg-background px-2 py-1 text-sm";
const vide = (): Ligne => ({ articleId: "", designation: "", quantite: "", prix: "", uniteParCarton: "" });

export function NouveauBonForm({ articles, fournisseurs, initial, estDirection = false, liens = [], taux = null }: { articles: Art[]; fournisseurs: Four[]; initial?: BonInitial; estDirection?: boolean; /** Taux du jour (indicatif : « ≈ » de l'autre devise). */ taux?: number | null; /** Fournisseurs connus de chaque article (2026-10-16), l'habituel marqué. */ liens?: { articleId: string; fournisseurId: string; habituel: boolean }[] }) {
  // Le brouillon vient de la base en notation anglaise (« 2.125 ») : écrit à la française dans les cases.
  const [lignes, setLignes] = useState<Ligne[]>(() => initial?.lignes.length
    ? initial.lignes.map((l) => ({ ...l, quantite: canoniqueVersSaisie(l.quantite), prix: canoniqueVersSaisie(l.prix), uniteParCarton: canoniqueVersSaisie(l.uniteParCarton) }))
    : [vide(), vide(), vide()]);
  // Une liste d'options par écran, partagée par toutes les lignes (recherche par désignation, nom court, code).
  const optionsArt = useMemo(() => optionsArticles(articles), [articles]);
  // Fournisseurs proposés d'abord : ceux qui fournissent les articles déjà choisis sur les lignes (« 3 sur 4 articles ») ; tous les autres restent dans la liste.
  const liensDe = useMemo(() => liensParArticle(liens), [liens]);
  const cleArticles = lignes.map((l) => l.articleId).join("|");
  const optionsFour = useMemo(() => optionsFournisseursPourArticles(fournisseurs, liensDe, cleArticles.split("|")), [fournisseurs, liensDe, cleArticles]);
  // Devise du bon : ses prix de ligne, son total sont dans cette devise, sans conversion (la devise de saisie fait foi).
  const [devise, setDevise] = useState<Devise>(initial?.devise === "CDF" ? "CDF" : "USD");
  const [noteDevise, setNoteDevise] = useState<string | null>(null);
  /** Prix catalogue proposé pour un article dans une devise (texte de saisie), "" sans prix. */
  const prixPropose = (articleId: string | null, d: Devise) => {
    const a = articleId ? articles.find((x) => x.id === articleId) : null;
    return canoniqueVersSaisie((d === "USD" ? a?.prix : a?.prixCDF) ?? "");
  };
  /**
   * Changer la devise du bon : un prix saisi dans l'autre devise n'est JAMAIS réinterprété (12 $ ne deviennent pas
   * 12 FC). Ligne reliée au catalogue : son prix catalogue dans la nouvelle devise est proposé (« ≈ » s'il vient de
   * l'autre devise) ; ligne libre : son prix est vidé, à ressaisir. L'écran le dit.
   */
  const changerDevise = (d: Devise) => {
    if (d === devise) return;
    const libres = lignes.filter((l) => !l.articleId && l.prix.trim() !== "").length;
    setDevise(d);
    setLignes((ls) => ls.map((l) => ({ ...l, prix: l.articleId ? prixPropose(l.articleId, d) : "" })));
    setNoteDevise(`Bon en ${d === "USD" ? "dollars ($)" : "francs (FC)"} : prix catalogue proposés dans cette devise${libres > 0 ? ` ; ${libres} prix saisi(s) à la main effacé(s), à ressaisir en ${d === "USD" ? "dollars" : "francs"}` : ""}.`);
  };
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
    maj(i, { articleId, designation: a ? a.designation : "", prix: prixPropose(articleId, devise), uniteParCarton: canoniqueVersSaisie(a?.uniteParCarton) });
  };
  // Dollars : quantité × prix. Francs : prix au centime de franc, total de ligne au centime (comme l'enregistrement).
  const arr2 = (n: number) => Math.round(n * 100) / 100;
  const totalLigneNum = (l: Ligne) => (devise === "USD" ? nombreDeSaisie(l.quantite) * nombreDeSaisie(l.prix) : arr2(nombreDeSaisie(l.quantite) * arr2(nombreDeSaisie(l.prix))));
  const total = devise === "USD" ? lignes.reduce((t, l) => t + totalLigneNum(l), 0) : arr2(lignes.reduce((t, l) => t + totalLigneNum(l), 0));
  const fmtTotal = (n: number) => (devise === "USD" ? `${n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $` : formaterMontantFacture(n, "CDF"));
  // Ligne sans prix (case vide ou 0) : signalée, son total est « — » et le total du bon est annoncé incomplet (jamais complété par un zéro).
  const sansPrix = (l: Ligne) => !(nombreDeSaisie(l.prix) > 0);
  const nbSansPrix = lignes.filter((l) => (l.designation.trim() || l.articleId) && nombreDeSaisie(l.quantite) > 0 && sansPrix(l)).length;

  return (
    // Entrée n'envoie jamais le bon : seul un clic sur le bouton l'enregistre.
    <form action={submit} onKeyDown={empecherEnvoiParEntree} className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm">
        <span className="font-medium">Devise du bon</span>
        <div role="group" aria-label="Devise du bon" className="inline-flex overflow-hidden rounded-md border">
          <button type="button" onClick={() => changerDevise("USD")} aria-pressed={devise === "USD"} className={`px-3 py-1.5 ${devise === "USD" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>Dollars ($)</button>
          <button type="button" onClick={() => changerDevise("CDF")} aria-pressed={devise === "CDF"} className={`px-3 py-1.5 ${devise === "CDF" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>Francs (FC)</button>
        </div>
        <input type="hidden" name="devise" value={devise} />
        <span className="text-xs text-muted-foreground">{devise === "CDF" ? "Prix et totaux en francs, sans conversion." : "Prix et totaux en dollars."}</span>
        {noteDevise && <p className="w-full text-xs text-sky-800">{noteDevise}</p>}
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Fournisseur</span>
          <ChoixRecherche options={optionsFour} name="fournisseurId" defaultValue={initial?.fournisseurId ?? ""} vide="— fournisseur —" aria-label="Fournisseur" className={inp} />
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
      <div className="overflow-x-auto rounded-lg border">
        {/* Tableur : Entrée descend (et ajoute une ligne en bas) sans envoyer le bon ; Tab reste celui
            du navigateur, pour passer aussi par l'article et la désignation. */}
        <table ref={racine} data-tableur="" data-tableur-tab="natif" className="w-full min-w-[48rem] text-sm">
          <thead className="bg-muted text-left">
            <tr>
              <th className="px-2 py-2">Article (catalogue)</th>
              <th className="px-2 py-2">Désignation</th>
              <th className="px-2 py-2 text-right">Quantité</th>
              <th className="px-2 py-2 text-right" title="Calculé : quantité ÷ unités par carton (défini au catalogue)">Cartons</th>
              <th className="px-2 py-2 text-right">P.U. {devise === "USD" ? "USD" : "FC"}</th>
              <th className="px-2 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {lignes.map((l, i) => (
              <tr key={i} className="border-t">
                <td className="px-2 py-1">
                  <ChoixRecherche options={optionsArt} colonne="article" value={l.articleId} vide="— libre —" onChange={(id) => choisirArticle(i, id)} aria-label={`Article, ligne ${i + 1}`} className={`${inp} w-full min-w-48`} />
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
                    const upc = nombreDeSaisie(l.uniteParCarton), q = nombreDeSaisie(l.quantite);
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
                    title={l.articleId ? "Prix fixé dans l'onglet Inventaire (modifiable là-bas)" : "Prix libre"}
                    min={0}
                    className={`${inp} w-24 text-right ${l.articleId ? "bg-muted/50 text-muted-foreground" : ""}`}
                    aria-label={`Prix unitaire, ligne ${i + 1}`}
                  />
                  {(() => {
                    // Prix de référence dans l'AUTRE devise que le bon : le prix proposé est une conversion au taux du jour, annoncée « ≈ ».
                    const a = l.articleId ? articles.find((x) => x.id === l.articleId) : null;
                    const ref = a?.refDevise ?? (a?.prixFC ? "CDF" : null);
                    const libRef = a?.prixRef ?? a?.prixFC ?? null;
                    return a && ref && ref !== devise && libRef ? <span className="block text-[10px] text-muted-foreground" title={`Prix de référence en ${ref === "CDF" ? "francs" : "dollars"} : converti au taux du jour`}>{libRef} ≈</span> : null;
                  })()}
                </td>
                <td className="px-2 py-1 text-right text-muted-foreground">{sansPrix(l) ? <span data-sans-prix className={nombreDeSaisie(l.quantite) > 0 ? "text-amber-800" : ""}>{nombreDeSaisie(l.quantite) > 0 ? "sans prix" : "—"}</span> : fmtTotal(totalLigneNum(l))}</td>
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
          <span className="text-lg font-semibold">{total > 0 || nbSansPrix === 0 ? fmtTotal(total) : "—"}</span>
          {devise === "CDF" && total > 0 && <span className="block text-xs text-muted-foreground">{libelleAutreDevise(total, "CDF", taux)} au taux du jour (indicatif : le bon reste en francs)</span>}
          {nbSansPrix > 0 && <span data-total-incomplet className="ml-2 text-xs font-medium text-amber-800">incomplet : {nbSansPrix} ligne(s) sans prix</span>}
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

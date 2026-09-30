// Passerelle fiche → PDF (`src/lib/pdf/fiche-technique.tsx`). Comme `fiche-calc.ts`, elle ne calcule
// RIEN : tous les montants et ratios viennent de `calculerCout` (même moteur, même contexte que
// l'écran et que l'export Excel), arrondis par `arrondirCentime` du moteur, et qualifiés comme à
// l'écran (« ≥ » sur un coût partiel, « — » pour un coût inconnu, jamais 0 ; « conseillé » /
// « sur coût partiel » dans le libellé des indicateurs de prix).
//
// Version « sans prix » (fiche à afficher au poste) : le moteur n'est même pas appelé et la fiche
// part SANS `chiffres` — aucun montant n'existe dans ce qui est transmis au document.
//
// Montants en texte PDF-sûr : `montantSigne` / `formaterNombre` de `@/lib/montant` (espaces
// ordinaires ; une marge négative entre parenthèses, jamais le signe « − »).

import { arrondirCentime, calculerCout, type ContexteCout } from "@/lib/fiches/cout";
import { ongletFiche } from "@/lib/fiches/famille-boisson";
import { formaterNombre, montantSigne } from "@/lib/montant";
import type { ChiffresFichePdf, FichePdf, IndicateurPdf, PhotoPdf } from "@/lib/pdf/fiche-technique";
import {
  MOTIF_LABEL, TYPE_LABEL, coef, etiquettePrix, noteCoutIncomplet, nomLigne, pct,
  type ArticleOption, type FicheVue,
} from "./fiche-calc";

export type ContexteFichePdf = {
  /** Contexte du moteur : TOUTES les fiches (les sous-recettes se résolvent entre elles). */
  contexte: ContexteCout;
  articles: Map<string, ArticleOption>;
  noms: Map<string, { nom: string }>;
};

/** Montant USD pour le PDF ; `null` → « — » (jamais 0). */
const montant = (n: number | null): string => (n === null ? "—" : montantSigne(n, "USD").texte);

/**
 * Prix d'achat HT au catalogue, par unité d'achat — ce que l'écran de la fiche affiche sous l'article.
 * C'est une DONNÉE du catalogue, pas un résultat : aucun arrondi au centime, jusqu'à 4 décimales
 * sous 1 $ (« 0,0153 $ / cl » ne devient pas « 0,02 $ »). Absent ou à 0 : « — » (le motif de la
 * ligne dit pourquoi) — jamais « 0,00 $ ».
 */
function prixCatalogue(art: ArticleOption): string {
  const p = art.prixUnitaireUSD === null ? NaN : Number(art.prixUnitaireUSD);
  if (!Number.isFinite(p) || p <= 0) return "—";
  return `${formaterNombre(p, { minimumFractionDigits: 2, maximumFractionDigits: p < 1 ? 4 : 2 })} $ / ${art.unite || "unité ?"}`;
}

/** Quantité lisible ; une quantité absente, nulle ou invalide est « à préciser », jamais « 0 ». */
function quantiteLisible(q: string): string {
  const n = Number(q);
  return q.trim() !== "" && Number.isFinite(n) && n > 0 ? formaterNombre(n, { maximumFractionDigits: 3 }) : "à préciser";
}

const lignesRecette = (recette: string): string[] => {
  const l = recette.replace(/\r\n?/g, "\n").split("\n").map((x) => x.trimEnd());
  while (l.length && !l[0].trim()) l.shift();
  while (l.length && !l[l.length - 1].trim()) l.pop();
  return l;
};

export function versFichePdf(
  vue: FicheVue,
  ctx: ContexteFichePdf,
  options: { avecPrix: boolean; photo: PhotoPdf | null },
): FichePdf {
  const bar = ongletFiche(vue) === "boissons";
  const portionsInvalides = !Number.isFinite(vue.nbPortions) || vue.nbPortions <= 0;
  const rendement = Number(vue.rendementQuantite);

  const mesures = vue.estSousRecette
    ? [`Rendement : ${vue.rendementQuantite && Number.isFinite(rendement) && rendement > 0 ? `${formaterNombre(rendement, { maximumFractionDigits: 3 })} ${vue.rendementUnite || "?"}` : "à préciser"}`]
    : [`Nombre de ${bar ? "verres" : "portions"} : ${portionsInvalides ? "à préciser" : vue.nbPortions}`];

  return {
    nom: vue.nom,
    rubrique: [TYPE_LABEL[vue.type] ?? vue.type, vue.categorie || "Sans catégorie", vue.estSousRecette ? "Sous-recette" : null].filter(Boolean).join(" · "),
    mesures,
    photo: options.photo,
    ingredients: vue.lignes.map((l, i) => ({
      nom: nomLigne(l, i, ctx.articles, ctx.noms),
      quantite: quantiteLisible(l.quantite),
      unite: l.unite || "—",
    })),
    recette: lignesRecette(vue.recette),
    chiffres: options.avecPrix ? chiffresDe(vue, ctx, { bar, portionsInvalides }) : null,
  };
}

function chiffresDe(vue: FicheVue, ctx: ContexteFichePdf, { bar, portionsInvalides }: { bar: boolean; portionsInvalides: boolean }): ChiffresFichePdf {
  const r = calculerCout(ctx.contexte.fiches.get(vue.id)!, ctx.contexte);

  // Mêmes distinctions qu'à l'écran de la fiche (editer-fiche.tsx) et que l'export Excel :
  // `incomplet` couvre trois causes, qu'on ne mélange pas — « ≥ » seulement sur un coût minoré.
  const coutConnu = r.lignes.some((l) => l.cout !== null);
  const coutPartiel = r.ingredientsSansPrix.length > 0 || r.cycle;
  const aucunIngredient = vue.lignes.length === 0;
  const noteCout = noteCoutIncomplet(r.incomplet, vue.lignes.length);
  const minore = (n: number) => `${coutPartiel ? "≥ " : ""}${montant(n)}`;

  const lignes = vue.lignes.map((l, i) => {
    const lc = r.lignes[i];
    const art = l.articleId ? ctx.articles.get(l.articleId) : undefined;
    const prixAchat = art ? prixCatalogue(art) : l.sousFicheId ? "sous-recette" : "—";
    return lc && lc.cout !== null
      ? { prixAchat, cout: `${lc.partiel ? "≥ " : ""}${montant(arrondirCentime(lc.cout))}`, motif: null }
      : { prixAchat, cout: "—", motif: lc?.motif ? MOTIF_LABEL[lc.motif] : "Coût indéterminé" };
  });

  const avertissements: string[] = [];
  if (coutPartiel) {
    avertissements.push(
      `Coût partiel : ${r.ingredientsSansPrix.length} ingrédient(s) au coût indéterminé${r.cycle ? " (boucle détectée entre fiches)" : ""}. ` +
        "Ils ne sont pas comptés pour zéro, ils ne sont pas comptés du tout : le coût affiché est un minorant.",
    );
  }
  if (portionsInvalides) avertissements.push("Nombre de portions inexploitable : le coût par portion est calculé sur 1 portion. Corrigez la fiche.");
  if (!coutConnu) {
    avertissements.push(aucunIngredient
      ? "Aucun ingrédient saisi : cette fiche n'a pas de coût connu (et surtout pas un coût de 0)."
      : "Aucun ingrédient n'est valorisé : cette fiche n'a pas de coût connu (et surtout pas un coût de 0).");
  }

  const cout: IndicateurPdf[] = [
    { libelle: coutPartiel ? "Coût total HT (partiel)" : "Coût total HT", valeur: coutConnu ? minore(arrondirCentime(r.coutTotal)) : "—", alerte: coutPartiel || !coutConnu },
    { libelle: `${bar ? "Coût par verre" : "Coût par portion"}${coutPartiel ? " (partiel)" : ""}`, valeur: coutConnu ? minore(arrondirCentime(r.coutParPortion)) : "—", alerte: coutPartiel || portionsInvalides || !coutConnu },
  ];

  // Bloc prix : comme à l'écran, absent pour une sous-recette qui n'a pas de prix de vente.
  let prix: ChiffresFichePdf["prix"] = null;
  if (!vue.estSousRecette || r.prixVenteHT !== null) {
    const et = (base: string) => etiquettePrix(base, r.prixEstConseille, noteCout);
    const tva = Number(vue.tauxTVA || "0");
    const alerte = r.incomplet;
    prix = {
      origine: r.prixEstConseille
        ? "Aucun prix de vente n'a été décidé : ces montants sont dérivés du coefficient cible, ce sont des suggestions."
        : r.prixVenteTTC === null
          ? "Aucun prix de vente saisi, et aucun coefficient cible exploitable."
          : "Montants dérivés du prix de vente TTC saisi.",
      alerte: r.incomplet
        ? `Ces montants reposent sur un coût ${aucunIngredient ? "inconnu" : "partiel"}${
            coutPartiel
              ? ` (${r.ingredientsSansPrix.length} ingrédient(s) non valorisé(s))`
              : aucunIngredient ? " (aucun ingrédient saisi : le coût de revient n'est pas 0, il est inconnu)" : " (nombre de portions inexploitable)"
          } : ils ne sont pas fiables. N'arrêtez pas un prix de vente là-dessus.`
        : null,
      indicateurs: [
        { libelle: et("Prix de vente TTC"), valeur: montant(r.prixVenteTTC), alerte },
        { libelle: et("Prix de vente HT"), valeur: montant(r.prixVenteHT), alerte },
        // Le taux de TVA est un PARAMÈTRE de la fiche, pas un résultat : jamais qualifié.
        { libelle: "Taux de TVA", valeur: Number.isFinite(tva) ? pct(tva) : "—" },
        { libelle: et("Coefficient"), valeur: coef(r.coefficient), alerte },
        { libelle: et("Taux de marque"), valeur: pct(r.tauxMarque), alerte },
        { libelle: et("Marge brute"), valeur: montant(r.margeBrute), alerte },
        { libelle: et("Taux de marge"), valeur: pct(r.tauxMarge), alerte },
        { libelle: et("Ratio matière"), valeur: pct(r.ratioMatiere), alerte },
      ],
      prixConseille: r.prixConseille
        ? `Prix conseillé (coefficient cible) : ${r.prixConseille.minorant ? "≥ " : ""}${montant(r.prixConseille.ht)} HT (${r.prixConseille.minorant ? "≥ " : ""}${montant(r.prixConseille.ttc)} TTC)${
            r.prixConseille.minorant ? " — coût partiel : ce n'est pas un prix, c'est un plancher." : ""
          }`
        : null,
    };
  }

  return {
    lignes,
    total: coutConnu ? `${minore(arrondirCentime(r.coutTotal))}${coutPartiel ? " (coût partiel)" : ""}` : "— (coût inconnu)",
    avertissements,
    nonValorises: r.ingredientsSansPrix,
    cout,
    prix,
  };
}

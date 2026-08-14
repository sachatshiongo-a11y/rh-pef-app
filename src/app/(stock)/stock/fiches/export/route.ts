import { verifySession, requireModule } from "@/lib/auth";
import { classeurExcel } from "@/lib/export-excel";
import { calculerCout, arrondirCentime } from "@/lib/fiches/cout";
import { chargerFichesVues, chargerArticlesDesFiches } from "../_data/charger-fiche";
import { construireContexte, TYPE_LABEL } from "../_data/fiche-calc";

// Export Excel des fiches techniques (toutes, ou la sélection de la barre d'actions groupées).
// Les coûts sont recalculés par le moteur au moment de l'export : jamais un chiffre stocké,
// jamais un arrondi maison.

export async function GET(req: Request) {
  const user = await verifySession();
  requireModule(user, "stock");

  const param = new URL(req.url).searchParams.get("ids");
  const choisis = new Set((param ?? "").split(",").map((s) => s.trim()).filter(Boolean));

  const [vues, articles] = await Promise.all([chargerFichesVues(), chargerArticlesDesFiches()]);
  const contexte = construireContexte(vues, new Map(articles.map((a) => [a.id, a])));
  const retenues = choisis.size ? vues.filter((v) => choisis.has(v.id)) : vues;

  const lignes = retenues.map((v) => {
    const r = calculerCout(contexte.fiches.get(v.id)!, contexte);
    const coutConnu = r.lignes.some((l) => l.cout !== null);
    const partiel = r.ingredientsSansPrix.length > 0 || r.cycle;

    // ⚠️ Dans un tableur, une colonne se copie, se trie, s'imprime et se recolle SANS le reste de sa
    // ligne : une mention rangée dans une autre colonne ne protège rien. Chaque chiffre issu d'un
    // coût incomplet porte donc sa qualification DANS SA PROPRE CELLULE — il devient du texte, et
    // c'est exactement le but : un montant non fiable ne doit pas pouvoir être additionné en
    // silence. Les chiffres sûrs, eux, restent des nombres.
    const qualifie = (v: number | null, minorant = false) =>
      v === null ? "" : r.incomplet ? `${minorant ? "≥ " : ""}${v} (coût partiel)` : v;

    return [
      v.nom,
      v.categorie,
      TYPE_LABEL[v.type] ?? v.type,
      v.estSousRecette ? "Sous-recette" : "Plat vendu",
      v.nbPortions,
      v.lignes.length,
      // Le coût, lui, est un minorant certain : ce qui manque ne peut qu'ajouter.
      coutConnu ? (partiel ? `≥ ${arrondirCentime(r.coutTotal)} (coût partiel)` : arrondirCentime(r.coutTotal)) : "",
      coutConnu ? (partiel ? `≥ ${arrondirCentime(r.coutParPortion)} (coût partiel)` : arrondirCentime(r.coutParPortion)) : "",
      partiel ? `OUI — ${r.ingredientsSansPrix.length} ingrédient(s)` : r.incomplet ? "OUI — portions inexploitables" : "Non",
      r.ingredientsSansPrix.join(" ; "),
      r.prixEstConseille ? "Conseillé (coefficient)" : r.prixVenteHT === null ? "—" : "Décidé (prix TTC saisi)",
      qualifie(r.prixVenteHT),
      qualifie(r.prixVenteTTC),
      qualifie(r.margeBrute),
      // Coefficient, taux de marque et ratio matière sont des RATIOS, pas des montants : on les met
      // en forme ici (comme `coef()`/`pct()` à l'écran). Aucun montant n'est arrondi ailleurs que
      // par `arrondirCentime` du moteur. Ils sont qualifiés comme les autres : dérivés d'un coût
      // incomplet, ils ne valent pas plus que lui.
      qualifie(r.coefficient === null ? null : Number(r.coefficient.toFixed(2))),
      qualifie(r.tauxMarque === null ? null : Number((r.tauxMarque * 100).toFixed(1))),
      qualifie(r.ratioMatiere === null ? null : Number((r.ratioMatiere * 100).toFixed(1))),
      // Le drapeau `minorant` vient du moteur : un prix conseillé sur coût partiel est un plancher.
      r.prixConseille === null ? "" : qualifie(r.prixConseille.ht, r.prixConseille.minorant),
      v.actif ? "Active" : "Inactive",
    ];
  });

  const buf = await classeurExcel({
    titre: "Fiches techniques — coût de revient",
    periode: new Date().toLocaleDateString("fr-FR"),
    feuilles: [{
      nom: "Fiches techniques",
      entete: [
        "Fiche", "Catégorie", "Type", "Nature", "Portions", "Ingrédients",
        "Coût total HT USD", "Coût / portion HT USD", "Coût partiel", "Ingrédients non valorisés",
        "Origine du prix", "PV HT USD", "PV TTC USD", "Marge brute USD",
        "Coefficient", "Taux de marque %", "Ratio matière %", "Prix conseillé HT USD", "État",
      ],
      lignes,
    }],
  });

  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Fiches_techniques_${new Date().toISOString().slice(0, 10)}.xlsx"`,
    },
  });
}

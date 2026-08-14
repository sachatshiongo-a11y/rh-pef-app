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
    return [
      v.nom,
      v.categorie,
      TYPE_LABEL[v.type] ?? v.type,
      v.estSousRecette ? "Sous-recette" : "Plat vendu",
      v.nbPortions,
      v.lignes.length,
      coutConnu ? arrondirCentime(r.coutTotal) : "",
      coutConnu ? arrondirCentime(r.coutParPortion) : "",
      // Le coût partiel voyage AVEC le chiffre : un export ne doit pas pouvoir être lu comme un
      // coût arrêté (mémoire « coût incomplet annoncé, jamais compté zéro »).
      partiel ? `OUI — ${r.ingredientsSansPrix.length} ingrédient(s)` : r.incomplet ? "OUI — portions inexploitables" : "Non",
      r.ingredientsSansPrix.join(" ; "),
      r.prixEstConseille ? "Conseillé (coefficient)" : r.prixVenteHT === null ? "—" : "Décidé (prix TTC saisi)",
      r.prixVenteHT ?? "",
      r.prixVenteTTC ?? "",
      r.margeBrute ?? "",
      // Coefficient, taux de marque et ratio matière sont des RATIOS, pas des montants : on les
      // met en forme ici (comme `coef()`/`pct()` à l'écran). Aucun montant n'est arrondi ailleurs
      // que par `arrondirCentime` du moteur.
      r.coefficient === null ? "" : Number(r.coefficient.toFixed(2)),
      r.tauxMarque === null ? "" : Number((r.tauxMarque * 100).toFixed(1)),
      r.ratioMatiere === null ? "" : Number((r.ratioMatiere * 100).toFixed(1)),
      // Le drapeau `minorant` du moteur : un prix conseillé sur coût partiel est un plancher.
      r.prixConseille === null ? "" : r.prixConseille.minorant ? `≥ ${r.prixConseille.ht}` : r.prixConseille.ht,
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

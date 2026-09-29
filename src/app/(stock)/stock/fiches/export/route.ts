import { exigerEspaceStock } from "@/lib/garde-route";
import { classeurExcel } from "@/lib/export-excel";
import { calculerCout, arrondirCentime } from "@/lib/fiches/cout";
import { chargerFichesVues, chargerArticlesDesFiches } from "../_data/charger-fiche";
import { construireContexte, TYPE_LABEL } from "../_data/fiche-calc";
import { familleBoisson, lireOngletFiches, ongletFiche, FAMILLES_BOISSON } from "@/lib/fiches/famille-boisson";

// Export Excel des fiches techniques : celles de l'onglet affiché (`?vue=plats|boissons`), ou la
// sélection de la barre d'actions groupées (`?ids=`, déjà limitée à l'onglet par l'écran).
// Sans l'un ni l'autre, toutes les fiches (ancien lien, conservé).
// Les coûts sont recalculés par le moteur au moment de l'export : jamais un chiffre stocké,
// jamais un arrondi maison.

export async function GET(req: Request) {
  const g = await exigerEspaceStock();
  if (!g.ok) return g.reponse;

  const sp = new URL(req.url).searchParams;
  const param = sp.get("ids");
  const choisis = new Set((param ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  const vue = sp.has("vue") ? lireOngletFiches(sp.get("vue")) : null;
  const boissons = vue === "boissons";
  const libelleFamille = new Map(FAMILLES_BOISSON.map((f) => [f.valeur, f.libelle]));
  const rangFamille = new Map(FAMILLES_BOISSON.map((f, i) => [f.valeur, i]));

  const [vues, articles] = await Promise.all([chargerFichesVues(), chargerArticlesDesFiches()]);
  const contexte = construireContexte(vues, new Map(articles.map((a) => [a.id, a])));
  const retenues = (choisis.size ? vues.filter((v) => choisis.has(v.id)) : vue ? vues.filter((v) => ongletFiche(v) === vue) : vues)
    // Onglet Boissons : même ordre qu'à l'écran — les cocktails & mocktails d'abord (tri stable :
    // l'ordre catégorie/nom du chargement est conservé à l'intérieur de chaque famille).
    .slice()
    .sort((a, b) => (boissons ? rangFamille.get(familleBoisson(a.categorie))! - rangFamille.get(familleBoisson(b.categorie))! : 0));

  const lignes = retenues.map((v) => {
    const r = calculerCout(contexte.fiches.get(v.id)!, contexte);
    const coutConnu = r.lignes.some((l) => l.cout !== null);
    const partiel = r.ingredientsSansPrix.length > 0 || r.cycle;
    // Fiche sans aucune ligne : son coût n'est pas 0, il est INCONNU. Troisième motif
    // d'incomplétude, à ne confondre ni avec « coût partiel » ni avec « portions inexploitables ».
    const aucunIngredient = v.lignes.length === 0;

    // ⚠️ Dans un tableur, une colonne se copie, se trie, s'imprime et se recolle SANS le reste de sa
    // ligne : une mention rangée dans une autre colonne ne protège rien. Chaque chiffre issu d'un
    // coût incomplet porte donc sa qualification DANS SA PROPRE CELLULE — il devient du texte, et
    // c'est exactement le but : un montant non fiable ne doit pas pouvoir être additionné en
    // silence. Les chiffres sûrs, eux, restent des nombres.
    //
    // Le MÊME raisonnement vaut pour un prix SUGGÉRÉ : son origine (« Origine du prix ») vit dans
    // une autre colonne, qui ne voyage pas avec la cellule. Un prix conseillé recollé seul dans un
    // tableau de tarifs deviendrait un prix arrêté. Il porte donc « conseillé » dans sa cellule,
    // même quand le coût est complet.
    const noteCout = !r.incomplet ? null : aucunIngredient ? "coût inconnu" : "coût partiel";
    const qualifie = (
      n: number | null,
      { minorant = false, conseille = false }: { minorant?: boolean; conseille?: boolean } = {},
    ) => {
      if (n === null) return "";
      const notes = [conseille ? "conseillé" : null, noteCout].filter(Boolean);
      return notes.length === 0 ? n : `${minorant ? "≥ " : ""}${n} (${notes.join(", ")})`;
    };

    return [
      v.nom,
      v.categorie,
      ...(boissons ? [libelleFamille.get(familleBoisson(v.categorie))!] : []),
      TYPE_LABEL[v.type] ?? v.type,
      v.estSousRecette ? "Sous-recette" : "Plat vendu",
      v.nbPortions,
      v.lignes.length,
      // Le coût, lui, est un minorant certain : ce qui manque ne peut qu'ajouter.
      coutConnu ? (partiel ? `≥ ${arrondirCentime(r.coutTotal)} (coût partiel)` : arrondirCentime(r.coutTotal)) : "",
      coutConnu ? (partiel ? `≥ ${arrondirCentime(r.coutParPortion)} (coût partiel)` : arrondirCentime(r.coutParPortion)) : "",
      partiel
        ? `OUI — ${r.ingredientsSansPrix.length} ingrédient(s)`
        : aucunIngredient
          ? "OUI — aucun ingrédient saisi"
          : r.incomplet
            ? "OUI — portions inexploitables"
            : "Non",
      r.ingredientsSansPrix.join(" ; "),
      r.prixEstConseille ? "Conseillé (coefficient)" : r.prixVenteHT === null ? "—" : "Décidé (prix TTC saisi)",
      qualifie(r.prixVenteHT, { conseille: r.prixEstConseille }),
      qualifie(r.prixVenteTTC, { conseille: r.prixEstConseille }),
      qualifie(r.margeBrute, { conseille: r.prixEstConseille }),
      // Coefficient, taux de marque et ratio matière sont des RATIOS, pas des montants : on les met
      // en forme ici (comme `coef()`/`pct()` à l'écran). Aucun montant n'est arrondi ailleurs que
      // par `arrondirCentime` du moteur. Ils sont qualifiés comme les autres : dérivés d'un coût
      // incomplet, ils ne valent pas plus que lui.
      qualifie(r.coefficient === null ? null : Number(r.coefficient.toFixed(2)), { conseille: r.prixEstConseille }),
      qualifie(r.tauxMarque === null ? null : Number((r.tauxMarque * 100).toFixed(1)), { conseille: r.prixEstConseille }),
      qualifie(r.tauxMarge === null ? null : Number((r.tauxMarge * 100).toFixed(1)), { conseille: r.prixEstConseille }),
      qualifie(r.ratioMatiere === null ? null : Number((r.ratioMatiere * 100).toFixed(1)), { conseille: r.prixEstConseille }),
      // Le drapeau `minorant` vient du moteur : un prix conseillé sur coût partiel est un plancher.
      // `conseille: true` sans condition : cette colonne n'est JAMAIS un prix arrêté, par nature.
      r.prixConseille === null ? "" : qualifie(r.prixConseille.ht, { minorant: r.prixConseille.minorant, conseille: true }),
      v.actif ? "Active" : "Inactive",
    ];
  });

  const suffixe = vue === "boissons" ? "Boissons" : vue === "plats" ? "Plats" : null;
  const buf = await classeurExcel({
    titre: `Fiches techniques${suffixe ? ` (${suffixe})` : ""} — coût de revient`,
    periode: new Date().toLocaleDateString("fr-FR"),
    feuilles: [{
      nom: suffixe ?? "Fiches techniques",
      entete: [
        "Fiche", "Catégorie", ...(boissons ? ["Famille"] : []), "Type", "Nature", "Portions", "Ingrédients",
        "Coût total HT USD", "Coût / portion HT USD", "Coût partiel", "Ingrédients non valorisés",
        "Origine du prix", "PV HT USD", "PV TTC USD", "Marge brute USD",
        "Coefficient", "Taux de marque %", "Taux de marge %", "Ratio matière %", "Prix conseillé HT USD", "État",
      ],
      lignes,
    }],
  });

  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Fiches_techniques_${suffixe ? `${suffixe}_` : ""}${new Date().toISOString().slice(0, 10)}.xlsx"`,
    },
  });
}

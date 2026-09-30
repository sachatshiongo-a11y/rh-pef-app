import { familleBoisson, lireOngletFiches, ongletFiche, FAMILLES_BOISSON, type OngletFiches } from "@/lib/fiches/famille-boisson";

// Quelles fiches part un export (Excel ou PDF), et dans quel ordre. UNE règle pour les deux
// formats : le PDF et le tableur d'un même clic contiennent les mêmes fiches, dans le même ordre.
//
//  - `?ids=` (sélection de la barre d'actions groupées, déjà limitée à l'onglet par l'écran ;
//    un seul identifiant pour le PDF d'une fiche) : exactement ces fiches ;
//  - sinon `?vue=plats|boissons` : les fiches de l'onglet affiché ;
//  - sinon (ancien lien) : toutes les fiches.
// L'ordre est celui du chargement (catégorie puis nom), qui est celui de l'écran. Onglet Boissons :
// les cocktails & mocktails d'abord, comme à l'écran (tri stable : l'ordre catégorie/nom est
// conservé à l'intérieur de chaque famille).

type FicheRangeable = { id: string; categorie: string; type: string; estSousRecette: boolean };

export function fichesAExporter<T extends FicheRangeable>(vues: T[], sp: URLSearchParams): { retenues: T[]; vue: OngletFiches | null } {
  const choisis = new Set((sp.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  const vue = sp.has("vue") ? lireOngletFiches(sp.get("vue")) : null;
  const rangFamille = new Map(FAMILLES_BOISSON.map((f, i) => [f.valeur, i]));
  const retenues = (choisis.size ? vues.filter((v) => choisis.has(v.id)) : vue ? vues.filter((v) => ongletFiche(v) === vue) : vues)
    .slice()
    .sort((a, b) => (vue === "boissons" ? rangFamille.get(familleBoisson(a.categorie))! - rangFamille.get(familleBoisson(b.categorie))! : 0));
  return { retenues, vue };
}

// Données de test de l'onglet Comparaison : 6 rubriques, écarts variés (livré ≠ commandé, livré non
// consommé, consommé plus que livré), « — » pour l'inconnu, grosses quantités (1 253), demi-unités.
// Déterministe : le même appel donne les mêmes lignes. Construit par `lignesComparaison`, comme la page.
import { lignesComparaison, type LigneComparaison, type LigneJours } from "@/lib/journalier-restaurant";

const NOMS_JOURS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
export const ISOS_FIXTURE = Array.from({ length: 7 }, (_, i) => `2026-09-${String(21 + i).padStart(2, "0")}`);
export const JOURS_FIXTURE = ISOS_FIXTURE.map((iso, i) => ({ iso, label: `${NOMS_JOURS[i]} ${21 + i}` }));
export const LABELS_FIXTURE = JOURS_FIXTURE.map((j) => j.label);

const CATS: Record<string, string[]> = {
  "Épicerie": ["Riz parfumé sac 25 kg", "Farine de blé T55 sac 25 kg", "Sucre en poudre", "Sauce tomate pelée boîte 2,5 kg", "Huile de tournesol bidon 20 L", "Spaghetti n°5 carton 12 x 500 g", "Penne rigate 500 g", "Sel fin iodé", "Poivre noir moulu", "Concentré de tomate", "Olives noires dénoyautées", "Câpres au vinaigre", "Farine de manioc"],
  "Viandes et poissons": ["Poulet entier congelé", "Filet de boeuf", "Cuisses de poulet", "Poisson capitaine filet", "Crevettes décortiquées 1 kg", "Lardons fumés", "Jambon de Parme", "Saucisses de porc", "Steak haché surgelé", "Tilapia entier"],
  "Produits laitiers": ["Mozzarella râpée 1 kg", "Parmesan Parmigiano Reggiano 24 mois", "Crème fraîche 30 % 1 L", "Beurre doux 500 g", "Lait entier UHT", "Ricotta", "Gorgonzola", "Yaourt nature"],
  "Boissons": ["Coca-Cola 33 cl carton", "Eau minérale 50 cl", "Fanta orange 33 cl", "Bière Primus 65 cl", "Vin rouge de la maison 75 cl", "Jus de mangue 1 L", "Sprite 33 cl", "Bière Tembo 65 cl", "Eau gazeuse 75 cl", "Café en grains 1 kg", "Thé noir en sachets"],
  "Légumes frais": ["Oignons", "Tomates", "Poivrons", "Salade", "Carottes", "Courgettes", "Aubergines", "Pommes de terre", "Ail", "Basilic", "Champignons", "Épinards"],
  "Boulangerie": ["Pain burger", "Pain baguette", "Pâte à pizza 250 g", "Croûtons", "Chapelure", "Levure de boulanger"],
};

/** Lignes de la comparaison pour `n` articles (jusqu'à 60), telles que la page les fabrique. */
export function lignesFixture(n: number): LigneComparaison[] {
  const tous = Object.entries(CATS).flatMap(([c, ns]) => ns.map((nom) => ({ c, nom }))).slice(0, n);
  const articles: { id: string; designation: string; categorie: string }[] = [];
  const commandes: Record<string, number> = {};
  const livraisons: LigneJours[] = [];
  const consoParArticle = new Map<string, (string | null)[]>();
  const legumes: { nom: string; cmd: number[]; liv: number[] }[] = [];
  tous.forEach((a, ai) => {
    const cmd = ISOS_FIXTURE.map((_, ji) => ((ai * 3 + ji * 5) % 4 === 0 ? ((ai + ji) % 6) + 1 + (ai % 7 === 0 ? 1250 : 0) : 0));
    const liv = cmd.map((c, ji) => (c === 0 ? ((ai + ji) % 11 === 0 ? 2 : 0) : (ai + ji) % 5 === 0 ? c + 2 : (ai + ji) % 7 === 0 ? Math.max(c - 1, 0) : c));
    const conso = ISOS_FIXTURE.map((_, ji) => ((ai + ji) % 6 === 0 && ai % 3 !== 0 ? null : liv[ji]! > 0 ? String((ai + ji) % 4 === 0 ? liv[ji]! - 1 : (ai + ji) % 9 === 0 ? liv[ji]! + 1.5 : liv[ji]!) : (ai + ji) % 8 === 0 ? "0.5" : "0"));
    if (a.c === "Légumes frais") { legumes.push({ nom: a.nom, cmd, liv }); return; }
    const id = `a${ai}`;
    articles.push({ id, designation: a.nom, categorie: a.c });
    ISOS_FIXTURE.forEach((j, ji) => { if (cmd[ji]) commandes[`${id}_${j}`] = cmd[ji]!; });
    livraisons.push({ id, designation: a.nom, jours: liv, total: liv.reduce((x, y) => x + y, 0) });
    consoParArticle.set(id, conso);
  });
  return lignesComparaison({ jours: ISOS_FIXTURE, articles, commandes, livraisons, consoParArticle, inclureHorsCatalogue: false, legumes });
}

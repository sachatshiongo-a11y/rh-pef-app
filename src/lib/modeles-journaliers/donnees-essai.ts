import fs from "node:fs";
import path from "node:path";
import { lireClasseurVentes } from "@/lib/classeur-ventes";
import { cleLegume, lireClasseurCommande } from "@/lib/classeur-commande";
import { ficheCommandeJournaliere, ficheRapportJournalier, type ArticleCommande, type EspaceFiche, type Fiche, type LegumeCommande } from "@/lib/fiches-conso";
import { cleCase, lignesDuRapport, type FicheVendue } from "@/lib/ventes-journalieres";
import { LEGUMES } from "@/app/(stock)/stock/legumes/legumes-data";

// Données d'ESSAI des documents journaliers (tests et exemples montrés à la Direction) : l'état de
// l'application APRÈS les deux imports de classeurs (chaque plat, boisson et article porte le libellé,
// le rang et la rubrique de sa ligne), avec des chiffres, des cases non saisies, un 0 saisi, et des
// lignes ABSENTES des classeurs (rubrique connue, rubrique inconnue). Réservé aux tests.

const gabarit = (nom: string) => new Uint8Array(fs.readFileSync(path.join(process.cwd(), "assets/modeles", nom)));
export const SEMAINE_ESSAI = ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"];

/** Rapport de la semaine 40 : `dimanche` ajoute une vente le dimanche. */
export async function fichesRapportEssai(options: { dimanche?: boolean; ajouts?: boolean; desactive?: string } = {}): Promise<Fiche[]> {
  const lu = await lireClasseurVentes(gabarit("rapport-journalier.xlsx"));
  if (!lu.ok) throw new Error(lu.erreur);
  const fiches: FicheVendue[] = lu.lignes
    .filter((l) => l.rubrique !== "Pâtes") // décochée à l'import : le choix d'une forme, pas une vente
    .map((l, i) => ({ id: `f${i}`, nom: l.nom, categorie: l.rubrique, type: l.feuille === "CUISINE" ? "PLAT" : "BAR", actif: true, libelleVente: l.nom, ordreVente: l.rang }));
  if (options.ajouts !== false) {
    fiches.push(
      { id: "sup1", nom: "Supplément fromage râpé", categorie: "Supplément", type: "PLAT", actif: true },
      { id: "sup2", nom: "Supplément sauce", categorie: "Supplément", type: "PLAT", actif: true },
      { id: "new1", nom: "Gâteau d'anniversaire", categorie: "Desserts", type: "PLAT", actif: true },
      { id: "new2", nom: "Plat du jour", categorie: "Suggestions du chef", type: "PLAT", actif: true },
      { id: "new3", nom: "Jus de bissap", categorie: "Jus de fruit", type: "BAR", actif: true },
    );
  }
  // Plat désactivé depuis, qui porte des ventes cette semaine.
  for (const f of fiches) if (options.desactive && f.nom === options.desactive) f.actif = false;
  const ventes = new Map<string, number>();
  const vendre = (id: string, j: number, q: number) => ventes.set(cleCase(`fiche:${id}`, SEMAINE_ESSAI[j]!), q);
  fiches.forEach((f, i) => {
    // Lundi → mercredi saisis (0 compris) ; jeudi, vendredi, samedi : non saisis (« — »).
    for (let j = 0; j < 3; j++) vendre(f.id, j, (i * 7 + j * 3) % 11 === 0 ? 0 : (i + j * 5) % 9);
  });
  if (options.dimanche) { vendre(fiches[1]!.id, 6, 4); vendre(fiches.find((f) => f.type === "BAR")!.id, 6, 2); }
  return (["CUISINE", "BAR"] as EspaceFiche[]).map((espace) => ficheRapportJournalier({ espace, jours: SEMAINE_ESSAI, lignes: lignesDuRapport(espace, fiches), ventes }));
}

/** Commande du mardi 29/09/2026. */
export async function fichesCommandeEssai(options: { ajouts?: boolean; date?: string } = {}): Promise<Fiche[]> {
  const date = options.date ?? "2026-09-29";
  const lu = await lireClasseurCommande(gabarit("commande-journaliere.xlsx"));
  if (!lu.ok) throw new Error(lu.erreur);
  // Comme l'import : un légume de la liste n'est rattaché à aucun article (statut LEGUME).
  const legume = (n: string) => LEGUMES.some((l) => cleLegume(l.nom) === cleLegume(n));
  const articles: (ArticleCommande & { domaine: EspaceFiche })[] = lu.lignes
    .filter((l) => !(l.feuille === "CUISINE" && l.rubrique === "Fruits & Légumes frais" && legume(l.nom)))
    .map((l, i) => ({
      id: `a${i}`, designation: `${l.nom.trim()} (catalogue)`, nomCourt: l.nom.trim(), unite: l.feuille === "CUISINE" ? l.unite ?? "Kg" : "Bouteille", categorie: null,
      surFicheCommande: true, ordreCommande: l.rang, rubriqueCommande: l.rubrique, domaine: l.feuille,
    }));
  if (options.ajouts !== false) {
    articles.push(
      { id: "x1", designation: "Burrata 125 g", nomCourt: "Burrata", unite: "Pièce", categorie: "Crèmerie", surFicheCommande: true, ordreCommande: null, rubriqueCommande: "Crèmerie-Fromagerie", domaine: "CUISINE" },
      { id: "x2", designation: "Zébu haché", nomCourt: null, unite: "Kg", categorie: "Boucherie locale", surFicheCommande: true, ordreCommande: null, rubriqueCommande: null, domaine: "CUISINE" },
      { id: "x3", designation: "Primus 72 cl", nomCourt: "Primus", unite: "Bouteille", categorie: null, surFicheCommande: true, ordreCommande: null, rubriqueCommande: "Bière locale", domaine: "BAR" },
    );
  }
  const commandes = new Map<string, number>(), livraisons = new Map<string, number>();
  articles.forEach((a, i) => {
    if (i % 4 === 0) commandes.set(a.id, (i % 7) + 1);
    if (i % 4 === 0 && i % 8 !== 0) livraisons.set(a.id, (i % 7) + 1);
    if (i % 9 === 1) livraisons.set(a.id, 2.5);
  });
  for (const id of ["x1", "x2", "x3"]) commandes.set(id, 3);
  const legumes: LegumeCommande[] = LEGUMES.map((l, i) => ({ designation: l.nom, unite: l.unite, commande: i % 3 === 0 ? i + 1 : null, livraison: i % 6 === 0 ? i + 0.5 : null }));
  return (["CUISINE", "BAR"] as EspaceFiche[]).map((espace) => ficheCommandeJournaliere({
    espace, date, articles: articles.filter((a) => a.domaine === espace), commandes, livraisons, legumes: espace === "CUISINE" ? legumes : undefined,
  }));
}

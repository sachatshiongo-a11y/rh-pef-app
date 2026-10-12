// GARDE-FOU « LES MÊMES MOTS PARTOUT » (plan d'ergonomie du 2026-10-12, V6, annexe C).
//
// Trois mots retenus par la Direction, dans les TROIS espaces de bureau et l'espace salarié :
//   - « Accueil » (et non « Tableau de bord ») : menu, titre de page, texte d'aide ; « Vue annuelle » (et non
//     « Tableau de bord annuel ») pour l'écran annuel de l'Exploitation (lot 6, V4) ;
//   - factures : « À payer » / « Payée » (et non « À régler » / « Réglée » / « Réglé ») : libellés, filtres,
//     pastilles, cartes de chiffres, en-têtes d'export, messages, PDF ;
//   - demandes : « Approuvée » / « Refusée » (et non « Acceptée »), congés, acomptes, fiches, stock, ratios.
//
// Ce qu'il lit : le texte des fichiers sources, COMMENTAIRES RETIRÉS (un commentaire peut dire « réglé » ; l'écran non).
// Ce qu'il ne couvre PAS : les VALEURS d'énumération (A_REGLER, REGLEE, APPROUVE… restent en base : rien ne migre) ni les
// paramètres d'adresse (`?statut=REGLEE`) ; le sens « réglé = configuré » du pointage (position du restaurant) ;
// l'« Accepté » du contrat signé (masculin : c'est l'acte du salarié, pas le statut d'une demande).
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { STATUT_FACTURE_LABEL } from "@/lib/stock";
import { STATUT_DEMANDE } from "@/lib/libelles-espace";
import { LIBELLE_STATUT_CONGE } from "@/lib/conges-liste";

const SRC = path.join(__dirname, "..");
const L = "(?<![\\p{L}])"; // « début de mot » qui connaît les lettres accentuées (\b ne les connaît pas)
const R = "(?![\\p{L}])";

/** Les interdits : un motif, ce qu'il faut écrire à la place. */
const INTERDITS: { nom: string; motif: RegExp; remplace: string; sauf?: RegExp }[] = [
  { nom: "« Tableau de bord »", motif: /["'>`]Tableau de bord["'<`]/u, remplace: "Accueil" },
  // V4 : « Graphiques » a rejoint la Vue annuelle ; l'ancien titre de cet écran ne revient pas.
  { nom: "« Tableau de bord annuel »", motif: new RegExp(`${L}tableau de bord annuel${R}`, "iu"), remplace: "Vue annuelle" },
  // « réglé = configuré » (position du restaurant, pointage) n'a rien à voir avec une facture.
  { nom: "« À régler »", motif: new RegExp(`${L}à régler${R}`, "iu"), remplace: "À payer", sauf: /pointage/ },
  { nom: "« Réglée(s) / Réglé(s) »", motif: new RegExp(`${L}réglée?s?${R}`, "iu"), remplace: "Payée(s) / Payé(s)", sauf: /pointage/ },
  { nom: "« Acceptée(s) » (une demande)", motif: new RegExp(`${L}Acceptées?${R}`, "u"), remplace: "Approuvée(s)" },
  { nom: "« a été acceptée » (une demande)", motif: new RegExp(`${L}a été acceptées?${R}`, "iu"), remplace: "a été approuvée" },
  { nom: "« demandes … acceptées »", motif: new RegExp(`${L}demandes? de congé acceptées?${R}`, "iu"), remplace: "approuvées" },
];

/** Le texte d'un fichier, sans ses commentaires (`//…` hors adresse http://, et blocs). */
export function sansCommentaires(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Les fautes d'un texte : « interdit @ ligne ». */
export function fautesDeVocabulaire(texte: string, chemin: string): string[] {
  const fautes: string[] = [];
  const lignes = sansCommentaires(texte).split("\n");
  for (const i of INTERDITS) {
    if (i.sauf?.test(chemin)) continue;
    lignes.forEach((ligne, n) => { if (i.motif.test(ligne)) fautes.push(`${chemin}:${n + 1} ${i.nom} → ${i.remplace}`); });
  }
  return fautes;
}

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (/\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n)) out.push(p);
  }
  return out;
}

describe("vocabulaire — Accueil, À payer / Payée, Approuvée / Refusée", () => {
  const fichiers = sources(SRC);

  it("le garde-fou lit bien des fichiers (une lecture vide ne doit pas passer pour un succès)", () => {
    expect(fichiers.length).toBeGreaterThan(500);
  });

  it("aucun libellé affiché n'emploie les anciens mots", () => {
    const fautes = fichiers.flatMap((f) => fautesDeVocabulaire(readFileSync(f, "utf8"), path.relative(SRC, f)));
    expect(fautes).toEqual([]);
  });

  it("les libellés d'état exportés disent les nouveaux mots", () => {
    expect(STATUT_FACTURE_LABEL).toMatchObject({ A_REGLER: "À payer", REGLEE: "Payée" });
    expect(STATUT_DEMANDE.APPROUVE.label).toBe("Approuvée");
    expect(STATUT_DEMANDE.REFUSE.label).toBe("Refusée");
    expect(LIBELLE_STATUT_CONGE).toMatchObject({ APPROUVE: "Approuvée", REFUSE: "Refusée" });
  });

  // FALSIFICATION : le détecteur doit mordre sur chacun des anciens mots, et laisser passer ce qui est permis.
  describe("le détecteur mord (falsification)", () => {
    const mord = (texte: string, chemin = "src/app/x/page.tsx") => fautesDeVocabulaire(texte, chemin).length > 0;
    it("refuse les anciens mots écrits dans un libellé", () => {
      expect(mord('const a = { label: "Tableau de bord" };')).toBe(true);
      expect(mord('<Kpi label="À régler cette semaine" />')).toBe(true);
      expect(mord('A_REGLER: "à régler",')).toBe(true);
      expect(mord('REGLEE: "Réglée",')).toBe(true);
      expect(mord('<span>Réglé 200,00 $</span>')).toBe(true);
      expect(mord('["REGLEE", "Réglées"]')).toBe(true);
      expect(mord('APPROUVE: { label: "Acceptée" }')).toBe(true);
      expect(mord('`Votre demande a été acceptée ✅`')).toBe(true);
      expect(mord('<p>Vos demandes de congé acceptées se lisent ici</p>')).toBe(true);
      expect(mord('<h1>Tableau de bord annuel</h1>')).toBe(true);
      expect(mord('Voir le tableau de bord annuel {annee} →')).toBe(true);
    });
    it("laisse passer les nouveaux mots, les commentaires et ce qui n'est pas du vocabulaire de facture ou de demande", () => {
      expect(mord('const a = { label: "Accueil" };')).toBe(false);
      expect(mord('REGLEE: "Payée", A_REGLER: "À payer"')).toBe(false);
      expect(mord("// une facture réglée, À régler, Acceptée : commentaire")).toBe(false);
      expect(mord("/* Tableau de bord, réglée */ const x = 1;")).toBe(false);
      expect(mord('"Pas encore réglée : l\'affiche ne peut pas être imprimée."', "src/app/(app)/parametres/pointage-reglages.tsx")).toBe(false);
      expect(mord('"Accepté par le salarié le 12/10"')).toBe(false); // contrat signé : masculin, hors périmètre
      expect(mord('"Seules USD et FC sont acceptées"')).toBe(false); // « acceptées » minuscule : pas un statut de demande
      expect(mord('<h1>Vue annuelle</h1> <Link>Voir la vue annuelle 2026 →</Link>')).toBe(false);
      expect(mord("const reglees = 3; REGLEE; A_REGLER; a-regler")).toBe(false); // identifiants et valeurs d'adresse
    });
  });
});

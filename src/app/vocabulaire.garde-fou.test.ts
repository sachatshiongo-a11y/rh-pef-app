// GARDE-FOU « LES MÊMES MOTS PARTOUT » (plan d'ergonomie du 2026-10-12, V6, annexe C).
//
// Trois mots retenus par la Direction, dans les TROIS espaces de bureau et l'espace salarié :
//   - « Accueil » (et non « Tableau de bord ») : menu, titre de page, texte d'aide ; « Vue annuelle » (et non
//     « Tableau de bord annuel ») pour l'écran annuel de l'Exploitation (lot 6, V4) ;
//   - factures : « À payer » / « Payée » (et non « À régler » / « Réglée » / « Réglé ») : libellés, filtres,
//     pastilles, cartes de chiffres, en-têtes d'export, messages, PDF ;
//   - demandes : « Approuvée » / « Refusée » (et non « Acceptée »), congés, acomptes, fiches, stock, ratios ;
//   - boutons de décision : « Approuver » (et non « Valider »), décision de la Direction du 2026-10-12. « Validé » /
//     « Pas validé » / « Validés » restent des ÉTATS (bulletins, bons de commande) ; « À valider » reste le NOM de la
//     boîte de décisions (menu, titres, pastilles). Seul le GESTE change de verbe.
//
// Ce qu'il lit : le texte des fichiers sources, COMMENTAIRES RETIRÉS (un commentaire peut dire « réglé » ; l'écran non).
// Ce qu'il ne couvre PAS : les VALEURS d'énumération (A_REGLER, REGLEE, APPROUVE… restent en base : rien ne migre) ni les
// paramètres d'adresse (`?statut=REGLEE`) ; le sens « réglé = configuré » du pointage (position du restaurant) ;
// l'« Accepté » du contrat signé (masculin : c'est l'acte du salarié, pas le statut d'une demande) ;
// les « Valider » qui enregistrent une saisie (EXCEPTIONS_VALIDER, plus bas, chacune avec sa raison).
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

// « Valider » n'est plus un libellé de bouton de décision (2026-10-12) : la Direction APPROUVE. Le motif vise le verbe
// à l'impératif / à l'infinitif écrit avec une majuscule (début de libellé : « Valider », « Valider (3) », « Valider ou
// refuser », « Validez la paie… ») et les tournures de message qui nomment le geste (« avant de valider », « faites-le
// valider »…). Il ne vise PAS : les états (« Validé », « Pas validé », « validés »), « À valider » (nom de la boîte), les
// identifiants (`validerDemandes`, `revalidatePath`) ni « faire valider par un comptable/juriste » (validation externe).
const VERBE_VALIDER = new RegExp(
  `${L}(?:Valider|Validez)${R}|${L}(?:avant de|doit d'abord|faites-le|ne pas|sans rien) valider${R}`,
  "u",
);

/**
 * Les « Valider » qui restent, chacun avec sa raison : ces boutons n'approuvent la demande de personne, ils ENREGISTRENT
 * une saisie (le verbe est celui du formulaire, comme « Enregistrer »). Une exception sans raison est un oubli déguisé.
 */
export const EXCEPTIONS_VALIDER: { fichier: string; raison: string }[] = [
  {
    fichier: "app/(stock)/stock/entree/entree-client.tsx",
    raison: "« Valider l'entrée en stock » enregistre la saisie d'une entrée (formulaire) ; aucune demande d'un tiers, aucun « Refuser » en vis-à-vis.",
  },
  {
    fichier: "app/(stock)/stock/mouvements/mouvements-client.tsx",
    raison: "« Valider l'entrée » / « Valider la sortie » enregistrent un mouvement saisi (formulaire) ; le vert et le rouge codent le sens du mouvement, pas une décision.",
  },
  {
    fichier: "app/(stock)/stock/commandes/[id]/reception-client.tsx",
    raison: "« Valider la réception » enregistre les quantités saisies à la réception d'un bon DÉJÀ approuvé ; ce n'est pas l'approbation du bon.",
  },
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

/** Les « Valider » de décision d'un texte : « ligne ». Les fichiers d'EXCEPTIONS_VALIDER sont dispensés (cf. plus haut). */
export function fautesVerbeValider(texte: string, chemin: string, exceptions = EXCEPTIONS_VALIDER): string[] {
  if (exceptions.some((e) => e.fichier === chemin)) return [];
  return sansCommentaires(texte).split("\n").flatMap((ligne, n) =>
    VERBE_VALIDER.test(ligne) ? [`${chemin}:${n + 1} « Valider » (bouton ou message de décision) → Approuver`] : []);
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

  it("aucun bouton ni message de décision ne dit « Valider » (la Direction approuve)", () => {
    const fautes = fichiers.flatMap((f) => fautesVerbeValider(readFileSync(f, "utf8"), path.relative(SRC, f).split(path.sep).join("/")));
    expect(fautes).toEqual([]);
  });

  it("chaque exception « Valider » est encore vraie : fichier existant, qui dit toujours « Valider », et raison écrite", () => {
    for (const { fichier, raison } of EXCEPTIONS_VALIDER) {
      const texte = readFileSync(path.join(SRC, fichier), "utf8");
      expect(VERBE_VALIDER.test(sansCommentaires(texte)), `exception périmée : ${fichier} ne dit plus « Valider »`).toBe(true);
      expect(raison.trim().length, `exception sans raison : ${fichier}`).toBeGreaterThan(30);
    }
  });

  it("le bouton vert est unique : BoutonValider a disparu, « Approuver » est son libellé par défaut", () => {
    const source = readFileSync(path.join(SRC, "components/action-buttons.tsx"), "utf8");
    expect(source).not.toMatch(/export function BoutonValider/);
    expect(source).toContain('children ?? "Approuver"');
    expect(fichiers.filter((f) => /\bBoutonValider\b/.test(sansCommentaires(readFileSync(f, "utf8")))).map((f) => path.relative(SRC, f))).toEqual([]);
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
    it("« Valider » : refusé en libellé de bouton de décision et en message qui nomme le geste", () => {
      const mordV = (texte: string, chemin = "app/x/page.tsx") => fautesVerbeValider(texte, chemin).length > 0;
      expect(mordV('<BoutonApprouver>Valider</BoutonApprouver>')).toBe(true);
      expect(mordV('<Bouton>{`Valider (${n})`}</Bouton>')).toBe(true);
      expect(mordV('actionLabel="Valider"')).toBe(true);
      expect(mordV('"Valider ou refuser"')).toBe(true);
      expect(mordV('message = "Valider quand même ?"')).toBe(true);
      expect(mordV('"Validez la paie d\'abord"')).toBe(true);
      expect(mordV('"rechargez la page avant de valider."')).toBe(true);
      expect(mordV('"faites-le valider avant d\'enregistrer"')).toBe(true);
      // Une exception dispense son fichier — et lui seul.
      expect(fautesVerbeValider(">Valider l'entrée<", "app/a.tsx", [{ fichier: "app/a.tsx", raison: "x" }])).toEqual([]);
      expect(fautesVerbeValider(">Valider l'entrée<", "app/b.tsx", [{ fichier: "app/a.tsx", raison: "x" }]).length).toBe(1);
    });
    it("« Valider » : laisse passer les états, la boîte « À valider », les identifiants et les commentaires", () => {
      const mordV = (texte: string) => fautesVerbeValider(texte, "app/x/page.tsx").length > 0;
      expect(mordV('<option value="VALIDE">Validé</option> "Pas validé" "Validés"')).toBe(false);
      expect(mordV('<h1>À valider</h1> "Rien à valider" "Bulletins à valider"')).toBe(false);
      expect(mordV("validerDemandes(ids); revalidatePath(\"/a-valider\"); function valider() {}")).toBe(false);
      expect(mordV('"À faire valider par un juriste."')).toBe(false); // validation externe, pas le geste de la Direction
      expect(mordV("// Valider, payer, rouvrir : commentaire\n/* Valider */ const x = 1;")).toBe(false);
      expect(mordV('<BoutonApprouver>Approuver la sélection</BoutonApprouver>')).toBe(false);
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

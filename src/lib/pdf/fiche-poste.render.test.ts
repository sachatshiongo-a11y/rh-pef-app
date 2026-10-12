import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { FichePoste } from "@prisma/client";
import { renderPdfBuffer } from "./fonts";
import { FichePosteDocument, MENTION_NON_EXHAUSTIVE } from "./fiche-poste";
import { entreprise as societe } from "./theme";
import { pagesDuPdf, policesDeRepli, textesPoses } from "@/lib/test/pdf-lecture";

/**
 * Fiche de poste — les rubriques du modèle Word (« PEF_FICHE_DE_POSTE_* »), dans son ordre, et une
 * liste longue qui se répartit sur plusieurs pages. Audit du 10/10 : une liste de ~55 lignes
 * s'imprimait avec les lignes SUPERPOSÉES, compressées en page 1 (tout le bloc était insécable,
 * `wrap={false}`, donc plus haut que la page : react-pdf l'écrase pour le faire tenir).
 *
 * Les textes ci-dessous sont ceux du Word « Chef de cuisine » ; ils ne servent que de jeu d'essai
 * (rien n'est écrit en base). `PDF_ECHANTILLONS=<dossier>` dépose aussi les PDF pour les regarder.
 */

const fiche = (extra: Partial<FichePoste> = {}): FichePoste => ({
  id: "f1", poste: "Chef de cuisine", descriptionPoste: null, description: null, risquesContraintes: null,
  typeContrat: "Contrat à durée déterminée, à temps plein (durée à déterminer).", echelleSalariale: "600 usd",
  categorieProfessionnelle: null, superieurHierarchique: "Gérante du restaurant", tempsTravail: "36 heures/semaine",
  competencesTechniques: null, savoirEtre: null, formationsRequises: null, diplomesRequis: null, experiencesExigees: null,
  fichierUrl: null, fichierNom: null, creeParId: null, createdAt: new Date("2026-07-07T10:00:00Z"), updatedAt: new Date("2026-10-12T09:30:00Z"),
  ...extra,
});

const CHEF = fiche({
  descriptionPoste: [
    "Superviser l'ensemble des opérations de la cuisine et garantir la qualité des plats servis.",
    "Élaborer les menus en tenant compte des saisons, des produits disponibles et des tendances culinaires.",
    "Former, motiver et encadrer le personnel de cuisine.",
    "Suivre les stocks de denrées alimentaires et gérer les commandes auprès des fournisseurs en étroite collaboration avec le gestionnaire de stock et des achats.",
    "Mettre en place des procédures de contrôle pour éviter le gaspillage.",
  ].join("\n"),
  description: "Inventaire quotidien des denrées alimentaires dans la cuisine et des boissons au bar en collaboration avec un second de cuisine et le responsable du bar.\nPasser les commandes et faire les achats nécessaires.",
  risquesContraintes: "Station debout prolongée, Manutention de charges et exposition à l’hygrométrie, Milieu bruyant, utilisation de produits chimiques, risques biologiques Utilisation de matériel et d’ustensiles coupants.",
  savoirEtre: "Excellentes compétences en management et capacité à fédérer une équipe.\nTalent pour la création culinaire et sens esthétique de la présentation des plats.\nPassioné par la cuisine.",
});

const LONGUE = (n: number) => fiche({
  poste: "Responsable de production",
  descriptionPoste: Array.from({ length: n }, (_, i) => `Mission numéro ${i + 1} : assurer le suivi de la production et rendre compte à la Direction chaque semaine.`).join("\n"),
  description: Array.from({ length: 8 }, (_, i) => `Activité ${i + 1}`).join("\n"),
  risquesContraintes: "Station debout prolongée\nMilieu bruyant",
  experiencesExigees: "Expérience en restauration",
});

const rendre = (f: FichePoste, classe: string | null = null) => renderPdfBuffer(FichePosteDocument({ fiche: f, classe }));
const texteDe = async (pdf: Buffer) => (await pagesDuPdf(pdf)).map((p) => p.plat).join(" ");

function deposer(nom: string, pdf: Buffer) {
  const dossier = process.env.PDF_ECHANTILLONS;
  if (dossier) { fs.mkdirSync(dossier, { recursive: true }); fs.writeFileSync(path.join(dossier, nom), pdf); }
}

describe("fiche de poste — rubriques du modèle Word, dans son ordre", () => {
  it("titre, bandeaux et rubriques dans l'ordre du modèle ; Risques et contraintes présent", async () => {
    const pdf = await rendre(CHEF, "Agent de maîtrise");
    deposer("fiche-chef-de-cuisine.pdf", pdf);
    const t = await texteDe(pdf);
    const ordre = [
      "FICHE DE POSTE", "Identification du poste", "Intitulé :", "Type de contrat :", "Échelle salariale :",
      "Supérieur hiérarchique direct :", "Lieu de travail :", "Temps de travail :", "Description du poste",
      "Missions principales du poste :", "Activités et tâches principales :", "Risques et contraintes du poste :",
      "La fiche de poste ne décrit pas", "Compétences requises pour le poste", "Compétences techniques :",
      "Savoir-être, soft skills :", "Formations requises :", "Expériences exigées :",
    ];
    let depuis = 0;
    for (const m of ordre) {
      const i = t.indexOf(m, depuis);
      expect(i, `« ${m} » absent ou hors ordre`).toBeGreaterThanOrEqual(0);
      depuis = i + m.length;
    }
    expect(t).toContain("Station debout prolongée");
    expect(t).toContain("Agent de maîtrise");
  }, 60_000);

  it("la mention du modèle (« ne décrit pas les activités de façon exhaustive ») est imprimée telle quelle, pour toute fiche", async () => {
    expect(MENTION_NON_EXHAUSTIVE).toBe("La fiche de poste ne décrit pas les activités de façon exhaustive. L’agent peut être amené à réaliser d’autres activités selon les besoins du service.");
    for (const f of [CHEF, fiche()]) {
      expect(await texteDe(await rendre(f))).toContain("La fiche de poste ne décrit pas les activités de façon exhaustive. L’agent peut être amené à réaliser d’autres activités selon les besoins du service.");
    }
  }, 60_000);

  it("une rubrique vide dit « Non renseigné » (jamais un blanc qui laisserait croire à « aucun risque ») ; Diplômes requis seulement s'il est saisi", async () => {
    const vide = await texteDe(await rendre(fiche()));
    expect(vide).toContain("Risques et contraintes du poste : Non renseigné");
    expect(vide).not.toContain("Diplômes requis");
    expect(await texteDe(await rendre(fiche({ diplomesRequis: "Diplôme en gestion" })))).toContain("Diplômes requis : • Diplôme en gestion");
  }, 60_000);

  it("date de mise à jour et « Page x sur y » au pied ; en-tête (intitulé du poste) ; aucune police de repli ni glyphe douteux", async () => {
    const pdf = await rendre(CHEF);
    const t = await texteDe(pdf);
    expect(t).toContain("mise à jour le 12/10/2026");
    expect(t).toMatch(/Page 1 sur 1/);
    expect(policesDeRepli(pdf)).toEqual([]);
    expect(t).not.toMatch(/[ ⚠→−]/);
  }, 60_000);
});

describe("fiche de poste — pied de page commun (identifiants de la société)", () => {
  // Même composant que le contrat, l'attestation, le bon de commande… (PdfFooter) : coordonnées et identifiants légaux.
  it("RCCM, Id. Nat., N. Impôt, adresse, téléphone, e-mail, compte : sur CHAQUE page", async () => {
    const pages = await pagesDuPdf(await rendre(LONGUE(55)));
    expect(pages.length).toBeGreaterThanOrEqual(2);
    for (const [i, p] of pages.entries()) {
      for (const v of [`RCCM : ${societe.rccm}`, `Id. Nat. : ${societe.idNat}`, `N. Impôt : ${societe.numImpot}`, `Adresse : ${societe.adresse}`, `Téléphone : ${societe.telephone}`, `E-mail : ${societe.email}`, societe.compteEcobank]) {
        expect(p.plat, `page ${i + 1} : ${v}`).toContain(v);
      }
    }
  }, 60_000);

  it("les identifiants saisis dans Paramètres (entreprise résolue) remplacent les valeurs par défaut", async () => {
    const pdf = await renderPdfBuffer(FichePosteDocument({ fiche: CHEF, classe: null, entreprise: { ...societe, rccm: "CD/TEST/RCCM/99", idNat: "99-TEST-N1", numImpot: "Z999" } }));
    const t = await texteDe(pdf);
    expect(t).toContain("RCCM : CD/TEST/RCCM/99");
    expect(t).toContain("Id. Nat. : 99-TEST-N1");
    expect(t).toContain("N. Impôt : Z999");
    expect(t).not.toContain(societe.rccm);
  }, 60_000);
});

describe("fiche de poste — liste longue", () => {
  it("55 missions : plusieurs pages, chaque ligne à sa place, jamais superposée", async () => {
    const pdf = await rendre(LONGUE(55));
    deposer("fiche-liste-longue.pdf", pdf);
    const pages = await pagesDuPdf(pdf);
    expect(pages.length).toBeGreaterThanOrEqual(2);
    expect(pages.length).toBeLessThanOrEqual(5);
    const textes = await textesPoses(pdf);
    const lignes = textes.filter((x) => /^Mission numéro \d+ :/.test(x.texte) || /^Mission numéro \d+/.test(x.texte));
    // Les 55 missions sont toutes là, chacune une fois.
    expect(new Set(lignes.map((x) => x.texte.match(/^Mission numéro (\d+)/)![1])).size).toBe(55);
    // Deux lignes d'une même page sont séparées d'au moins la hauteur du corps (10 pt) : posées
    // les unes sur les autres, elles tomberaient à 0.
    for (const p of new Set(lignes.map((x) => x.page))) {
      const ys = lignes.filter((x) => x.page === p).map((x) => x.y).sort((a, b) => a - b);
      for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1], `page ${p}`).toBeGreaterThanOrEqual(10);
    }
    // Les rubriques suivantes existent encore, après la liste.
    const plat = pages.map((p) => p.plat).join(" ");
    expect(plat.indexOf("Mission numéro 55")).toBeLessThan(plat.indexOf("Risques et contraintes du poste"));
    expect(plat).toContain("Expérience en restauration");
  }, 60_000);

  it("en-tête (intitulé du poste) et pied « Page x sur y » sur CHAQUE page", async () => {
    const pdf = await rendre(LONGUE(55));
    const pages = await pagesDuPdf(pdf);
    pages.forEach((p, i) => {
      expect(p.plat, `page ${i + 1}`).toContain(`Page ${i + 1} sur ${pages.length}`);
      expect(p.plat).toContain("Responsable de production");
    });
  }, 60_000);

  it("un intitulé de rubrique n'est jamais seul en bas de page : il part avec sa première ligne", async () => {
    const INTITULE = /^(Missions principales du poste|Activités et tâches principales|Risques et contraintes du poste|Expériences exigées) :$/;
    for (let n = 14; n <= 40; n += 3) {
      const pdf = await rendre(LONGUE(n));
      const textes = await textesPoses(pdf);
      for (const t of textes.filter((x) => INTITULE.test(x.texte))) {
        // Une ligne de contenu (puce) se trouve sur la même page, à droite de l'intitulé, à sa hauteur ou en dessous.
        const contenu = textes.filter((x) => x.page === t.page && x.x > t.x + 60 && x.y >= t.y - 2);
        expect(contenu.length, `n=${n}, « ${t.texte} » page ${t.page}`).toBeGreaterThan(0);
      }
    }
  }, 120_000);
});

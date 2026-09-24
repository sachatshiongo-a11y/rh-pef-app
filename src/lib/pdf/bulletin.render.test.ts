import { describe, it, expect } from "vitest";
import type { Employee, PayrollLine, PayrollRun } from "@prisma/client";
import { renderPdfBuffer } from "./fonts";
import { BulletinDocument } from "./bulletin";

/**
 * Le bas du bulletin dit le SALAIRE NET (hors transport), l'indemnité de transport à part, puis le
 * TOTAL VERSÉ — décision Direction 2026-09-22. Avant, « SALAIRE NET À PAYER » portait le total
 * versé et le net de la fiche ne s'y retrouvait jamais. Ligne réelle : Aimée Mutita, sept. 2026.
 */
async function texteDu(buffer: Buffer): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const { pages } = await new PDFParse({ data: new Uint8Array(buffer) }).getText();
  return pages.map((p) => p.text).join("\n").replace(/\s+/g, " ");
}

const employee = {
  id: "e1", matricule: "PEF-007", nom: "Aimée Mutita", sexe: "F", poste: "Cuisinière", secteur: "Cuisine",
  categorie: "BRIGADE", contrat: "CDD", enfants: 0, salaireMensuel: 250, dateEmbauche: new Date("2025-01-06"),
  heuresHebdomadaires: 48, transportJourCDF: 10000,
} as unknown as Employee;

const run = { id: "r1", mois: 9, annee: 2026, tauxChangeUtilise: 2800, statut: "BROUILLON" } as unknown as PayrollRun;

function ligne(surcharges: Partial<Record<keyof PayrollLine, unknown>> = {}): PayrollLine {
  return {
    id: "l1", employeeId: "e1", payrollRunId: "r1", statutPaiement: "PAS_VALIDE",
    remuneration100: 264.94, remuneration2_3: 0, remunerationJoursPayesUSD: 0, hsValorisee: 1.96,
    heuresTravaillees: 208, heuresContractuelles: 208, heuresSupp30: 1, heuresSupp60: 0, heuresSupp100: 0,
    joursPayes100: 26, joursPayes2_3: 0, joursNonPayes: 0, joursPayesNonTravailles: 0, joursCongePris: 0,
    indemniteCongesUSD: 0, fraisMedicauxUSD: 0, transportUSD: 114.78, primesUSD: 0, avantagesNatureUSD: 0,
    acompteUSD: 0, retenuePretUSD: 0, salBrutUSD: 418.51, cnssSalarieUSD: 15.19, netImposableUSD: 288.54,
    iprCalculeUSD: 34.83, allocFamilialeUSD: 0, salNetUSD: 368.5, salNetCDF: 368.5 * 2800,
    cnssPatronalUSD: 36.46, inppUSD: 9.11, onemUSD: 0.61, coutEmployeurUSD: 464.69, coutEmployeurCDF: 464.69 * 2800,
    datePaiement: null, modePaiement: null, payeParId: null,
    ...surcharges,
  } as unknown as PayrollLine;
}

type Conges = { dateDebut: Date; dateFin: Date }[];
const rendre = (l: PayrollLine, devise: "USD" | "CDF" = "USD", o: { congesPeriode?: Conges; run?: PayrollRun; employee?: Employee } = {}) =>
  renderPdfBuffer(BulletinDocument({ employee: o.employee ?? employee, ligne: l, run: o.run ?? run, devise, congesPeriode: o.congesPeriode ?? [], feries: [], primes: [], codesParJour: {} }));

describe("bulletin — le bas de page distingue salaire net, transport et total versé", () => {
  it("avec transport : SALAIRE NET 253,72 $, Indemnité de transport 114,78 $, TOTAL VERSÉ 368,50 $", async () => {
    const t = await texteDu(await rendre(ligne()));
    expect(t).toMatch(/SALAIRE NET\s*253,72 \$/);
    // Le libellé réel porte la mention « (non imposable, non cotisable) » avant le montant
    // (même <Text>, cf. bulletin.tsx) — chaîne attendue ajustée au rendu réel, montant inchangé.
    expect(t).toMatch(/Indemnité de transport \(non imposable, non cotisable\)\s*114,78 \$/);
    expect(t).toMatch(/TOTAL VERSÉ\s*368,50 \$/);
    expect(t).not.toContain("NET À PAYER");
    expect(t).not.toContain("versé au net");
  }, 60_000);

  it("sans transport : pas de ligne transport, et le total versé égale le salaire net", async () => {
    const t = await texteDu(await rendre(ligne({ transportUSD: 0, salNetUSD: 253.72, salBrutUSD: 303.73 })));
    expect(t).toMatch(/SALAIRE NET\s*253,72 \$/);
    expect(t).not.toContain("Indemnité de transport");
    expect(t).toMatch(/TOTAL VERSÉ\s*253,72 \$/);
  }, 60_000);

  it("en CDF, les trois montants sont au taux du bulletin", async () => {
    const t = await texteDu(await rendre(ligne(), "CDF"));
    expect(t).toMatch(/SALAIRE NET\s*710 416 CDF/); // 253,72 × 2 800 — format réel de formatMontant (« CDF », pas « FC »)
    expect(t).toMatch(/TOTAL VERSÉ\s*1 031 800 CDF/); // 368,50 × 2 800
  }, 60_000);
});

/** Nombre de pages du PDF rendu : le bulletin tient sur UNE page. */
async function pagesDu(buffer: Buffer): Promise<number> {
  const { PDFParse } = await import("pdf-parse");
  return (await new PDFParse({ data: new Uint8Array(buffer) }).getText()).pages.length;
}

/**
 * Polices déclarées dans le PDF (même lecture que `glyphes-manquants.test.ts`). Un texte qui tient
 * entièrement dans Optima n'embarque que des sous-ensembles préfixés « ABCDEF+ » ; un caractère
 * absent de la police (espace fine U+202F, ⚠, flèche…) fait apparaître une police standard non
 * embarquée — le glyphe sort barré ou remplacé à l'impression.
 */
function policesNonEmbarquees(pdf: Buffer): string[] {
  return [...pdf.toString("latin1").matchAll(/\/BaseFont\s*\/([A-Za-z0-9+\-_,]+)/g)]
    .map((m) => m[1])
    .filter((nom) => !/^[A-Z]{6}\+/.test(nom));
}

describe("bulletin — référence d'heures du mois (paie sur heures planifiées, 2026-09-23)", () => {
  it("ligne antérieure (source CONTRAT par défaut) : « Heures / mois », comme avant", async () => {
    const t = await texteDu(await rendre(ligne()));
    // Les libellés de la case récapitulative sont rendus en capitales (style `recapLabel`).
    expect(t).toMatch(/HEURES \/ MOIS\s*208 h/);
    expect(t).not.toContain("HEURES PLANIFIÉES");
  }, 60_000);

  it("source PLANNING : « Heures planifiées » et R (216 h), sur une seule page", async () => {
    const buf = await rendre(ligne({ sourceReference: "PLANNING", heuresContractuelles: 216 }));
    const t = await texteDu(buf);
    expect(t).toMatch(/HEURES PLANIFIÉES\s*216 h/);
    expect(await pagesDu(buf)).toBe(1);
    expect(policesNonEmbarquees(buf)).toEqual([]);
  }, 60_000);

  it("repli : « Heures contrat (repli) »", async () => {
    const t = await texteDu(await rendre(ligne({ sourceReference: "CONTRAT_REPLI" })));
    expect(t).toMatch(/HEURES CONTRAT \(REPLI\)\s*208 h/);
  }, 60_000);

  it("jours payés non travaillés en heures : base « 54 h (9 j) », une seule page avec un congé imprimé", async () => {
    // Le congé est réellement passé au rendu (`congesPeriode`) : la boîte des mentions l'imprime.
    const congesPeriode = [{ dateDebut: new Date("2026-09-14"), dateFin: new Date("2026-09-19") }];
    const buf = await rendre(ligne({ sourceReference: "PLANNING", heuresContractuelles: 156, heuresPayeesNonTravaillees: 54, joursPayesNonTravailles: 9, remunerationJoursPayesUSD: 82.05, joursCongePris: 9 }), "USD", { congesPeriode });
    const t = await texteDu(buf);
    expect(t).toMatch(/54 h \(9 j\)/);
    expect(t).toContain("CONGÉS PRIS SUR LA PÉRIODE");
    expect(t).toMatch(/du 14\/09\/2026 au 19\/09\/2026 — 6 jour\(s\) ouvrable\(s\)/);
    expect(await pagesDu(buf)).toBe(1);
  }, 60_000);

  // Correction 1 (relecture de la tâche 8) : « 54 h × taux affiché » ne retombait pas sur le montant
  // (taux arrondi à 2 décimales, facteur brut/net propre au moteur) — jusqu'à 0,49 $ d'écart. La
  // colonne Taux reste VIDE sur cette ligne, comme sur « Heures supplémentaires » ; le montant stocké
  // est imprimé tel quel. La base est suivie IMMÉDIATEMENT du montant : aucun taux entre les deux.
  it("jours payés non travaillés : colonne Taux vide, montant stocké inchangé (base en heures)", async () => {
    const t = await texteDu(await rendre(ligne({ sourceReference: "PLANNING", heuresContractuelles: 156, heuresPayeesNonTravaillees: 54, joursPayesNonTravailles: 9, remunerationJoursPayesUSD: 82.05 })));
    expect(t).toMatch(/Jours payés non travaillés \(congés, fériés, repos\)\s*54 h \(9 j\)\s*82,05 \$/);
    // La ligne des heures travaillées, elle, garde son taux horaire.
    expect(t).toMatch(/Salaire de base \(heures travaillées\)\s*\S+ h\s*[\d,]+ \$\s*[\d,]+ \$/);
  }, 60_000);

  it("jours payés non travaillés : colonne Taux vide aussi pour une ligne antérieure (base en jours)", async () => {
    const t = await texteDu(await rendre(ligne({ joursPayesNonTravailles: 4, remunerationJoursPayesUSD: 40 }), "CDF"));
    expect(t).toMatch(/Jours payés non travaillés \(congés, fériés, repos\)\s*4 j\s*112 000 CDF/); // 40 × 2 800
  }, 60_000);

  it("R fractionnaire : virgule décimale française (« 173,33 h »), jamais « 173.33 »", async () => {
    const buf = await rendre(ligne({ sourceReference: "PLANNING", heuresContractuelles: 173.33, heuresTravaillees: 157.5, heuresPayeesNonTravaillees: 7.5, joursPayesNonTravailles: 1, remunerationJoursPayesUSD: 10 }));
    const t = await texteDu(buf);
    expect(t).toMatch(/Salaire de base \(heures travaillées\)\s*156,5 h/); // 157,5 − 1 h sup.
    expect(t).toMatch(/HEURES PLANIFIÉES\s*173,33 h/);
    expect(t).toMatch(/7,5 h \(1 j\)/);
    expect(t).not.toContain("173.33");
    expect(policesNonEmbarquees(buf)).toEqual([]);
  }, 60_000);

  it("repli : le motif est imprimé en une ligne sobre, dans la police du bulletin", async () => {
    const buf = await rendre(ligne({ sourceReference: "CONTRAT_REPLI", motifReference: "Planning incomplet : semaine du 07/09 sans créneau" }));
    const t = await texteDu(buf);
    expect(t).toMatch(/Heures contrat \(repli\) : Planning incomplet : semaine du 07\/09 sans créneau/);
    expect(await pagesDu(buf)).toBe(1);
    expect(policesNonEmbarquees(buf)).toEqual([]);
  }, 60_000);

  it("repli : une espace fine dans le motif est normalisée (police embarquée seule)", async () => {
    // Le motif vient de la base : une espace fine insécable (U+202F, absente d'Optima) y ferait
    // basculer le rendu sur une police non embarquée, glyphe barré à l'impression.
    const buf = await rendre(ligne({ sourceReference: "CONTRAT_REPLI", motifReference: "Embauche le 15/09/2026\u202F: mois incomplet" }));
    expect(await texteDu(buf)).toContain("Heures contrat (repli) : Embauche le 15/09/2026 : mois incomplet");
    expect(policesNonEmbarquees(buf)).toEqual([]);
  }, 60_000);

  it("le motif n'apparaît que pour un repli", async () => {
    const t = await texteDu(await rendre(ligne({ sourceReference: "PLANNING", motifReference: "Motif résiduel" })));
    expect(t).not.toContain("Motif résiduel");
  }, 60_000);

  it("le motif le plus long (5 semaines vides) ne fait pas passer à deux pages les configurations courantes, en septembre (30 j) comme en octobre (31 j)", async () => {
    // Le motif occupe l'espace libre du cadre des rubriques (étiré à la hauteur du calendrier) : il
    // n'allonge pas la page. Configurations qui tiennent sur UNE page aujourd'hui, de la plus nue à la
    // plus chargée. Limite connue (rapport de la tâche 8) : quand les rubriques sont plus hautes que
    // le calendrier ET que la page est déjà pleine (toutes les rubriques optionnelles + payé), les
    // signatures passaient déjà en page 2 avec un congé ; la ligne du motif peut alors en faire autant.
    const semaines = ["31/08", "07/09", "14/09", "21/09", "28/09"].map((d) => `semaine du ${d} sans créneau`).join(", ");
    const motif = `Planning incomplet : ${semaines}`;
    const rubriques = { remunerationJoursPayesUSD: 40, joursPayesNonTravailles: 4, heuresPayeesNonTravaillees: 32, remuneration2_3: 12, acompteUSD: 50, retenuePretUSD: 20, fraisMedicauxUSD: 15, heuresSupp60: 2, heuresSupp100: 3 };
    const conge = [{ dateDebut: new Date("2026-09-07"), dateFin: new Date("2026-09-09") }];
    const cas: [string, Record<string, unknown>, typeof conge][] = [
      ["nu", {}, []],
      ["un congé", {}, conge],
      ["payé avec avantages en nature", { statutPaiement: "PAYE", avantagesNatureUSD: 30 }, []],
      ["toutes les rubriques", rubriques, []],
    ];
    const salarie = { ...employee, banque: "Rawbank", compteBancaire: "05100-01234567890-12" } as unknown as Employee;
    const pdf = (s: Record<string, unknown>, c: typeof conge, r: PayrollRun) => renderPdfBuffer(BulletinDocument({
      employee: salarie, ligne: ligne(s), run: r, devise: "CDF", congesPeriode: c, feries: [], primes: [{ nom: "Prime de rendement", montantUSD: 0 }], codesParJour: {},
    }));
    // Octobre 2026 : 31 lignes de calendrier, le cas qui renvoyait les signatures en page 2.
    for (const r of [run, runOctobre]) {
      for (const [nom, s, c] of cas) {
        const cle = `${nom}, mois ${r.mois}`;
        const sans = await pdf({ ...s, sourceReference: "CONTRAT" }, c, r);
        expect(await pagesDu(sans), `${cle} (sans motif)`).toBe(1);
        const avec = await pdf({ ...s, sourceReference: "CONTRAT_REPLI", motifReference: motif }, c, r);
        expect(await pagesDu(avec), `${cle} (avec motif)`).toBe(1);
        expect(await texteDu(avec), cle).toContain(`Heures contrat (repli) : ${motif}`);
        expect(policesNonEmbarquees(avec), cle).toEqual([]);
      }
    }
  }, 240_000);
});

/** Octobre 2026 : 31 jours, donc 31 lignes de calendrier (la hauteur maximale du corps). */
const runOctobre = { ...run, id: "r10", mois: 10 } as unknown as PayrollRun;

/**
 * Correction 1 (relecture de la tâche 8) : les signatures passaient seules en page 2 sur 6 bulletins
 * réels sur 72 (juin et juillet 2026 avec un congé). Le calendrier de 31 lignes fixe la hauteur du
 * corps ; son interligne a été resserré (calRow.paddingVertical 1.2 → 0.6). Salarié le plus chargé
 * en identité : catégorie professionnelle (une ligne de plus) et virement bancaire (mode de paiement).
 */
describe("bulletin — un mois de 31 jours tient sur une page", () => {
  const salarie = { ...employee, categorieProfessionnelle: "OUVRIER_QUALIFIE", banque: "Rawbank", compteBancaire: "05100-01234567890-12" } as unknown as Employee;
  const conge1 = { dateDebut: new Date("2026-10-05"), dateFin: new Date("2026-10-07") };
  const conge2 = { dateDebut: new Date("2026-10-19"), dateFin: new Date("2026-10-21") };
  const rendreOctobre = (s: Record<string, unknown>, congesPeriode: Conges, devise: "USD" | "CDF") =>
    rendre(ligne(s), devise, { congesPeriode, run: runOctobre, employee: salarie });

  for (const devise of ["USD", "CDF"] as const) {
    it(`31 jours, un congé, payé → une page (${devise})`, async () => {
      const buf = await rendreOctobre({ statutPaiement: "PAYE" }, [conge1], devise);
      const t = await texteDu(buf);
      expect(t).toContain("S 31"); // le calendrier compte bien 31 lignes
      expect(t).toContain("CONGÉS PRIS SUR LA PÉRIODE");
      expect(t).toContain("Mode de paiement");
      expect(await pagesDu(buf)).toBe(1);
    }, 60_000);

    it(`31 jours, payé, avec avantages en nature → une page (${devise})`, async () => {
      const buf = await rendreOctobre({ statutPaiement: "PAYE", avantagesNatureUSD: 30 }, [], devise);
      const t = await texteDu(buf);
      expect(t).toContain("Avantages en nature");
      expect(t).toContain("Mode de paiement");
      expect(await pagesDu(buf)).toBe(1);
    }, 60_000);
  }

  it("LIMITE CONNUE — 31 jours, deux congés, payé, avec avantages : encore 2 pages (lot de structure à part)", async () => {
    // Mesuré après le resserrement : 2 pages, avec ou sans catégorie professionnelle. Les polices ne
    // sont PAS réduites davantage (consigne) ; ce cas relève d'un lot de structure (mentions dans la
    // colonne des rubriques, par exemple). Le test fige ce qui passe en page 2 : les signatures
    // SEULES. Tout l'argent (salaire net, total versé) et les mentions restent en page 1. Quand le
    // lot de structure ramènera ce cas à une page, ce test passera au rouge : le mettre à jour.
    const buf = await rendreOctobre({ statutPaiement: "PAYE", avantagesNatureUSD: 30 }, [conge1, conge2], "CDF");
    const { PDFParse } = await import("pdf-parse");
    const { pages } = await new PDFParse({ data: new Uint8Array(buf) }).getText();
    expect(pages.length).toBe(2);
    const [p1, p2] = pages.map((p) => p.text.replace(/\s+/g, " "));
    expect(p1).toContain("TOTAL VERSÉ");
    expect(p1).toContain("Total congés : 6 jour(s)");
    expect(p1).toContain("Mode de paiement");
    expect(p2).toContain("Signature de la direction");
    expect(p2).not.toContain("TOTAL VERSÉ");
  }, 60_000);
});

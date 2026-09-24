import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import type { PaymentStatus } from "@prisma/client";
import { salaireNetUSD, salaireNetCDF, totalVerseUSD } from "@/lib/paie-net";
import { LIBELLE_STATUT } from "@/lib/paie-etats";
import { partiesDuLivre } from "@/lib/livre-paie";
import { classeurLivrePaie, ENTETE_LIVRE_EXCEL, MESSAGE_AUCUN_SALARIE, NOM_ONGLET_RECAP } from "@/lib/livre-paie-excel";

/**
 * Livre de paie par catégorie (Direction, 2026-09-24) : un onglet Brigade, un onglet Back-office,
 * un onglet Récapitulatif — et AUCUN montant qui change par rapport au livre d'un seul tenant.
 * Le classeur est relu avec ExcelJS : on vérifie le fichier PRODUIT, jamais les tableaux d'entrée.
 */

const TAUX = 2815.5;

type Ligne = {
  salBrutUSD: number; cnssSalarieUSD: number; iprCalculeUSD: number; transportUSD: number; salNetUSD: number;
  hsValorisee: number; heuresSupp30: number; heuresSupp60: number; heuresSupp100: number;
  statutPaiement: PaymentStatus;
  employee: { matricule: string; nom: string; categorie: string };
};

let seq = 0;
function ligne(nom: string, categorie: string, o: Partial<Ligne> = {}): Ligne {
  seq++;
  return {
    salBrutUSD: 312.47 + seq * 11.13, cnssSalarieUSD: 15.19 + seq, iprCalculeUSD: 7.03 * seq, transportUSD: 30.55 + seq,
    salNetUSD: 290.31 + seq * 9.07, hsValorisee: 0, heuresSupp30: 0, heuresSupp60: 0, heuresSupp100: 0,
    statutPaiement: (["PAS_VALIDE", "VALIDE", "PAYE"] as const)[seq % 3],
    employee: { matricule: `PEF-${String(seq).padStart(3, "0")}`, nom, categorie },
    ...o,
  };
}

// Noms volontairement dans le désordre, accents compris : l'ordre attendu est celui de localeCompare.
const BRIGADE = [
  ligne("Zoé Mbala", "BRIGADE"),
  ligne("Émile Kasongo", "BRIGADE", { hsValorisee: 12.5, heuresSupp30: 3, heuresSupp60: 1.5, heuresSupp100: 0.5 }),
  ligne("Aimée Mutita", "BRIGADE", { hsValorisee: 4.25, heuresSupp30: 1 }),
  ligne("eric Lunda", "BRIGADE"),
];
const BACKOFFICE = [ligne("Rachel Lunda", "BACKOFFICE"), ligne("Benoît Ilunga", "BACKOFFICE")];
const TOUTES = [...BACKOFFICE, ...BRIGADE];

/**
 * RÉFÉRENCE FIGÉE : le livre d'avant la séparation (route du 2026-09-23, recopiée telle quelle).
 * Une seule feuille, lignes triées par catégorie puis par nom, ligne « Total » = somme arrondie.
 */
const ENTETE_AVANT = ["Matricule", "Nom", "Catégorie", "Salaire brut $", "CNSS salarié $", "IPR $", "Transport $", "Salaire net $", "Salaire net CDF", "Total versé $", "Total versé CDF", "Statut"];
function livreAvant(lignes: Ligne[], taux: number) {
  const triees = [...lignes].sort((a, b) =>
    a.employee.categorie !== b.employee.categorie ? a.employee.categorie.localeCompare(b.employee.categorie) : a.employee.nom.localeCompare(b.employee.nom));
  const rows = triees.map((l) => [
    l.employee.matricule, l.employee.nom, l.employee.categorie,
    Number(Number(l.salBrutUSD).toFixed(2)), Number(Number(l.cnssSalarieUSD).toFixed(2)), Number(Number(l.iprCalculeUSD).toFixed(2)),
    Number(Number(l.transportUSD).toFixed(2)), Number(salaireNetUSD(l).toFixed(2)), Number(salaireNetCDF(l, taux).toFixed(0)),
    Number(totalVerseUSD(l).toFixed(2)), Number((totalVerseUSD(l) * taux).toFixed(0)), LIBELLE_STATUT[l.statutPaiement],
  ]);
  const total: Record<string, number> = {};
  ENTETE_AVANT.forEach((h, ci) => {
    if (!/(\$|CDF)$/.test(h)) return;
    total[h] = Math.round(rows.reduce((s, r) => s + Number(r[ci]), 0) * 100) / 100;
  });
  return { rows, total };
}

type Lu = { entete: string[]; donnees: unknown[][]; total: unknown[] | null; texte: string; rangEntete: number; rangTotal: number | null };

/** Relit une feuille : en-tête (1re ligne dont la cellule A vaut `debut`), données, ligne de total. */
function lire(ws: ExcelJS.Worksheet, debut: string, libelleTotal: string): Lu {
  const lignes: { rang: number; v: unknown[] }[] = [];
  ws.eachRow((row, rang) => lignes.push({ rang, v: (row.values as unknown[]).slice(1) }));
  const iEntete = lignes.findIndex((l) => l.v[0] === debut);
  const iTotal = lignes.findIndex((l) => l.v[0] === libelleTotal);
  return {
    entete: lignes[iEntete].v as string[],
    donnees: lignes.slice(iEntete + 1, iTotal === -1 ? undefined : iTotal).map((l) => l.v),
    total: iTotal === -1 ? null : lignes[iTotal].v,
    texte: lignes.map((l) => l.v.join(" | ")).join("\n"),
    rangEntete: lignes[iEntete].rang,
    rangTotal: iTotal === -1 ? null : lignes[iTotal].rang,
  };
}

async function classeur(lignes: Ligne[]) {
  const buf = await classeurLivrePaie({ lignes, taux: TAUX, periode: "septembre 2026" });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  return wb;
}

/** Plage d'autofiltre relue dans le fichier : « A8:N12 » → lignes 8 à 12. */
function plageFiltre(ws: ExcelJS.Worksheet): { de: number; a: number } | null {
  const af = ws.autoFilter as unknown;
  if (!af) return null;
  const ref = typeof af === "string" ? af : `${(af as { from: string }).from}:${(af as { to: string }).to}`;
  const m = /^[A-Z]+(\d+):[A-Z]+(\d+)$/.exec(ref);
  if (!m) throw new Error(`autofiltre illisible : ${JSON.stringify(af)}`);
  return { de: Number(m[1]), a: Number(m[2]) };
}

const val = (lu: Lu, rangee: unknown[], h: string) => rangee[lu.entete.indexOf(h)];

describe("livre de paie Excel — un onglet par catégorie", () => {
  it("trois onglets, dans l'ordre : Brigade, Back-office, Récapitulatif", async () => {
    const wb = await classeur(TOUTES);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Brigade", "Back-office", NOM_ONGLET_RECAP]);
  }, 30_000);

  it("chaque onglet porte les salariés de SA catégorie, triés par nom, avec son en-tête de société et de mois", async () => {
    const wb = await classeur(TOUTES);
    for (const [onglet, attendus] of [["Brigade", BRIGADE], ["Back-office", BACKOFFICE]] as const) {
      const ws = wb.getWorksheet(onglet)!;
      const lu = lire(ws, "Matricule", "Total");
      expect(lu.donnees.map((r) => r[1])).toEqual([...attendus].map((l) => l.employee.nom).sort((a, b) => a.localeCompare(b)));
      expect(lu.texte).toContain(`Pâtes en Folie (TOLYA SARL) — Livre de paie — ${onglet}`);
      expect(lu.texte).toContain("Période : septembre 2026");
      expect(lu.texte).toContain("Édité le : ");
    }
  }, 30_000);

  it("la ligne Total de chaque onglet additionne ses seules lignes, colonne par colonne", async () => {
    const wb = await classeur(TOUTES);
    for (const onglet of ["Brigade", "Back-office"]) {
      const lu = lire(wb.getWorksheet(onglet)!, "Matricule", "Total");
      expect(lu.total, `pas de ligne Total dans ${onglet}`).not.toBeNull();
      for (const h of ENTETE_LIVRE_EXCEL.filter((x) => /(\$|CDF)$/.test(x))) {
        const somme = Math.round(lu.donnees.reduce((s: number, r) => s + Number(val(lu, r, h)), 0) * 100) / 100;
        expect(val(lu, lu.total!, h), `${onglet} / ${h}`).toBe(somme);
      }
    }
  }, 30_000);

  it("le Récapitulatif reprend le total de chaque onglet, et « Total général » en est la somme", async () => {
    const wb = await classeur(TOUTES);
    const recap = lire(wb.getWorksheet(NOM_ONGLET_RECAP)!, "Catégorie", "Total général");
    expect(recap.donnees.map((r) => r[0])).toEqual(["Brigade", "Back-office"]);
    expect(recap.total).not.toBeNull();
    const montants = recap.entete.filter((h) => /(\$|CDF)$/.test(h));
    expect(montants).toEqual(ENTETE_LIVRE_EXCEL.filter((h) => /(\$|CDF)$/.test(h)));
    for (const [i, onglet] of ["Brigade", "Back-office"].entries()) {
      const lu = lire(wb.getWorksheet(onglet)!, "Matricule", "Total");
      expect(val(recap, recap.donnees[i], "Salariés")).toBe(lu.donnees.length);
      for (const h of montants) expect(val(recap, recap.donnees[i], h), `${onglet} / ${h}`).toBe(val(lu, lu.total!, h));
    }
    for (const h of [...montants, "Salariés"]) {
      const somme = Math.round(recap.donnees.reduce((s: number, r) => s + Number(val(recap, r, h)), 0) * 100) / 100;
      expect(val(recap, recap.total!, h), h).toBe(somme);
    }
  }, 30_000);

  it("l'autofiltre couvre l'en-tête et les données, JAMAIS la ligne des totaux", async () => {
    const wb = await classeur(TOUTES);
    for (const onglet of ["Brigade", "Back-office"]) {
      const ws = wb.getWorksheet(onglet)!;
      const lu = lire(ws, "Matricule", "Total");
      const plage = plageFiltre(ws);
      expect(plage, `pas d'autofiltre sur ${onglet}`).not.toBeNull();
      expect(plage!.de).toBe(lu.rangEntete);
      expect(plage!.a).toBe(lu.rangEntete + lu.donnees.length);
      expect(plage!.a).toBeLessThan(lu.rangTotal!);
    }
    // Récapitulatif : trois lignes dont un total — pas de filtre.
    expect(plageFiltre(wb.getWorksheet(NOM_ONGLET_RECAP)!)).toBeNull();
  }, 30_000);

  it("une catégorie sans salarié garde son onglet : « Aucun salarié », totaux à 0, aucun filtre", async () => {
    const wb = await classeur(BRIGADE);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Brigade", "Back-office", NOM_ONGLET_RECAP]);
    const ws = wb.getWorksheet("Back-office")!;
    const lu = lire(ws, "Matricule", "Total");
    expect(lu.donnees.map((r) => r[0])).toEqual([MESSAGE_AUCUN_SALARIE]);
    for (const h of ENTETE_LIVRE_EXCEL.filter((x) => /(\$|CDF)$/.test(x))) expect(val(lu, lu.total!, h), h).toBe(0);
    expect(plageFiltre(ws)).toBeNull();
    const recap = lire(wb.getWorksheet(NOM_ONGLET_RECAP)!, "Catégorie", "Total général");
    expect(val(recap, recap.donnees[1], "Salariés")).toBe(0);
    expect(val(recap, recap.donnees[1], "Salaire brut $")).toBe(0);
  }, 30_000);

  it("une catégorie hors Brigade/Back-office obtient son propre onglet, jamais fondue dans une autre", () => {
    const parties = partiesDuLivre([...TOUTES, ligne("Stagiaire X", "STAGIAIRE")]);
    expect(parties.map((p) => p.categorie)).toEqual(["BRIGADE", "BACKOFFICE", "STAGIAIRE"]);
    expect(parties[2].lignes.map((l) => l.employee.nom)).toEqual(["Stagiaire X"]);
  });
});

describe("livre de paie Excel — heures supplémentaires", () => {
  it("colonnes « Heures supp. (h) » et « Heures supp. $ » juste avant le brut, totalisées, reprises au récapitulatif", async () => {
    const i = ENTETE_LIVRE_EXCEL.indexOf("Salaire brut $");
    expect(ENTETE_LIVRE_EXCEL.slice(i - 2, i)).toEqual(["Heures supp. (h)", "Heures supp. $"]);
    const wb = await classeur(TOUTES);
    const lu = lire(wb.getWorksheet("Brigade")!, "Matricule", "Total");
    const emile = lu.donnees.find((r) => r[1] === "Émile Kasongo")!;
    expect(val(lu, emile, "Heures supp. (h)")).toBe(5); // 3 + 1,5 + 0,5
    expect(val(lu, emile, "Heures supp. $")).toBe(12.5);
    expect(val(lu, lu.total!, "Heures supp. $")).toBe(16.75); // 12,50 + 4,25
    const recap = lire(wb.getWorksheet(NOM_ONGLET_RECAP)!, "Catégorie", "Total général");
    expect(val(recap, recap.donnees[0], "Heures supp. $")).toBe(16.75);
    expect(val(recap, recap.donnees[1], "Heures supp. $")).toBe(0);
    expect(val(recap, recap.total!, "Heures supp. $")).toBe(16.75);
  }, 30_000);
});

describe("livre de paie Excel — aucun montant ne change", () => {
  it("chaque salarié garde, colonne par colonne, les valeurs du livre d'avant", async () => {
    const avant = livreAvant(TOUTES, TAUX);
    const wb = await classeur(TOUTES);
    const apres = new Map<string, { lu: Lu; r: unknown[] }>();
    for (const onglet of ["Brigade", "Back-office"]) {
      const lu = lire(wb.getWorksheet(onglet)!, "Matricule", "Total");
      for (const r of lu.donnees) apres.set(String(r[0]), { lu, r });
    }
    expect(apres.size).toBe(avant.rows.length); // même ensemble de lignes
    for (const r of avant.rows) {
      const a = apres.get(String(r[0]))!;
      ENTETE_AVANT.forEach((h, ci) => expect(val(a.lu, a.r, h), `${r[1]} / ${h}`).toEqual(r[ci]));
    }
  }, 30_000);

  it("les totaux par catégorie additionnés donnent exactement le total général d'avant", async () => {
    const avant = livreAvant(TOUTES, TAUX);
    const wb = await classeur(TOUTES);
    const recap = lire(wb.getWorksheet(NOM_ONGLET_RECAP)!, "Catégorie", "Total général");
    for (const [h, attendu] of Object.entries(avant.total)) {
      const somme = Math.round(recap.donnees.reduce((s: number, r) => s + Number(val(recap, r, h)), 0) * 100) / 100;
      expect(somme, `somme des catégories / ${h}`).toBe(attendu);
      expect(val(recap, recap.total!, h), `Total général / ${h}`).toBe(attendu);
    }
  }, 30_000);
});

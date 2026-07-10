import "server-only";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { parserClasseurFactures, type FactureImportee } from "@/lib/import-factures-excel";

// Import de factures fournisseurs depuis un classeur Excel, avec aperçu et journal réversible.
const normNom = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

export type FacturePreview = { fournisseurNom: string; numero: string | null; periode: string; montantUSD: number; statut: string; nouvelle: boolean };
export type PreviewFactures = {
  factures: FacturePreview[]; fournisseursCrees: string[]; erreurs: string[];
  resume: { aInserer: number; doublons: number; fournisseursCrees: number; totalUSD: number };
};

const sig = (r: { annee: number; mois: number; fournisseurNom: string; montantUSD: number; numero: string | null }) =>
  `${r.annee}|${r.mois}|${normNom(r.fournisseurNom)}|${r.montantUSD.toFixed(2)}|${r.numero ?? ""}`;

async function parseTous(fichiers: File[], taux: number, anneeDefaut: number): Promise<{ lignes: FactureImportee[]; erreurs: string[] }> {
  const lignes: FactureImportee[] = []; const erreurs: string[] = [];
  for (const f of fichiers) {
    const annee = Number((f.name.match(/(20\d{2})/) ?? [])[1]) || anneeDefaut;
    try { lignes.push(...(await parserClasseurFactures(await f.arrayBuffer(), annee, taux))); }
    catch (e) { erreurs.push(`${f.name} : ${e instanceof Error ? e.message : "illisible"}`); }
  }
  return { lignes, erreurs };
}

/** Analyse le(s) classeur(s) de factures et renvoie l'aperçu (aucune écriture). */
export async function analyserFactures(fichiers: File[]): Promise<PreviewFactures> {
  const config = await prisma.config.findUnique({ where: { id: "singleton" } });
  const taux = Number(config?.tauxChangeCDF ?? 2300) || 2300;
  const anneeDefaut = config?.anneeCourante ?? new Date().getFullYear();
  const { lignes, erreurs } = await parseTous(fichiers, taux, anneeDefaut);

  const fours = await prisma.fournisseur.findMany({ select: { nom: true } });
  const connus = new Set(fours.map((x) => normNom(x.nom)));
  const fournisseursCrees = [...new Set(lignes.map((l) => l.fournisseurNom))].filter((n) => !connus.has(normNom(n)));

  const existantes = await prisma.factureFournisseur.findMany({ select: { annee: true, mois: true, fournisseurNom: true, montantUSD: true, numero: true } });
  const vues = new Set(existantes.map((e) => sig({ annee: e.annee, mois: e.mois, fournisseurNom: e.fournisseurNom, montantUSD: Number(e.montantUSD), numero: e.numero })));

  const factures: FacturePreview[] = []; let aInserer = 0, doublons = 0, totalUSD = 0;
  for (const r of lignes) {
    const s = sig(r); const nouvelle = !vues.has(s);
    if (nouvelle) { vues.add(s); aInserer++; totalUSD += r.montantUSD; } else doublons++;
    factures.push({ fournisseurNom: r.fournisseurNom, numero: r.numero, periode: `${MOIS[(r.mois || 1) - 1]} ${r.annee}`, montantUSD: r.montantUSD, statut: r.statut, nouvelle });
  }
  return { factures, fournisseursCrees, erreurs, resume: { aInserer, doublons, fournisseursCrees: fournisseursCrees.length, totalUSD: Math.round(totalUSD * 100) / 100 } };
}

/** Applique l'import de factures et crée un ImportBatch réversible. */
export async function appliquerFactures(fichiers: File[], libelle: string, userId: string | null): Promise<{ batchId: string; resume: PreviewFactures["resume"] }> {
  const config = await prisma.config.findUnique({ where: { id: "singleton" } });
  const taux = Number(config?.tauxChangeCDF ?? 2300) || 2300;
  const anneeDefaut = config?.anneeCourante ?? new Date().getFullYear();
  const { lignes } = await parseTous(fichiers, taux, anneeDefaut);

  const res = await prisma.$transaction(async (tx) => {
    const batch = await tx.importBatch.create({ data: { type: "FACTURES", libelle, statut: "APPLIQUE", creeParId: userId } });
    const ops: Prisma.ImportOperationCreateManyInput[] = [];

    // Fournisseurs manquants
    const fours = await tx.fournisseur.findMany({ select: { id: true, nom: true } });
    const parNom = new Map(fours.map((x) => [normNom(x.nom), x.id]));
    let nbFour = 0;
    for (const nom of [...new Set(lignes.map((l) => l.fournisseurNom))]) {
      if (parNom.has(normNom(nom))) continue;
      const cree = await tx.fournisseur.create({ data: { nom, pays: "République démocratique du Congo" } });
      parNom.set(normNom(nom), cree.id); nbFour++;
      ops.push({ batchId: batch.id, entite: "Fournisseur", entiteId: cree.id, action: "CREATE", avant: Prisma.DbNull });
    }

    // Dé-duplication contre l'existant + intra-lot
    const existantes = await tx.factureFournisseur.findMany({ select: { annee: true, mois: true, fournisseurNom: true, montantUSD: true, numero: true } });
    const vues = new Set(existantes.map((e) => sig({ annee: e.annee, mois: e.mois, fournisseurNom: e.fournisseurNom, montantUSD: Number(e.montantUSD), numero: e.numero })));
    const aInserer = lignes.filter((r) => { const s = sig(r); if (vues.has(s)) return false; vues.add(s); return true; });
    let totalUSD = 0;
    for (const r of aInserer) {
      totalUSD += r.montantUSD;
      const fac = await tx.factureFournisseur.create({ data: {
        fournisseurId: parNom.get(normNom(r.fournisseurNom)) ?? null, fournisseurNom: r.fournisseurNom, numero: r.numero,
        date: r.date, dateEcheance: r.dateEcheance, datePaiement: r.datePaiement,
        montantUSD: r.montantUSD, montantRegleUSD: r.montantRegleUSD, resteAPayerUSD: r.resteAPayerUSD,
        statut: r.statut, modePaiement: r.modePaiement, mois: r.mois, annee: r.annee,
      } });
      ops.push({ batchId: batch.id, entite: "FactureFournisseur", entiteId: fac.id, action: "CREATE", avant: Prisma.DbNull });
    }
    const resume = { aInserer: aInserer.length, doublons: lignes.length - aInserer.length, fournisseursCrees: nbFour, totalUSD: Math.round(totalUSD * 100) / 100 };
    await tx.importBatch.update({ where: { id: batch.id }, data: { resume } });
    await tx.importOperation.createMany({ data: ops });
    return { batchId: batch.id, resume };
  }, { timeout: 120000 });

  return res;
}

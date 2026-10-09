import "server-only";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { donneesMontantsImportee, parserClasseurFactures, type FactureImportee } from "@/lib/import-factures-excel";
import { ajouterAuTotal, montantsFacture, totalVide, type TotalDevises } from "@/lib/facture-devise";

// Import de factures fournisseurs depuis un classeur Excel, avec aperçu et journal réversible.
import { cleAlnum as normNom } from "./texte";
import { anneeCouranteKinshasa } from "@/lib/heure-kinshasa";
const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

/** `montant` dans `devise` (2026-10-09 : une facture en francs n'est jamais convertie). `montantUSD` : ancien nom, USD seulement. */
export type FacturePreview = { fournisseurNom: string; numero: string | null; periode: string; devise: "USD" | "CDF"; montant: number; statut: string; nouvelle: boolean };
export type PreviewFactures = {
  factures: FacturePreview[]; fournisseursCrees: string[]; erreurs: string[];
  /** `totalUSD` : dollars seuls (comme avant) ; `total` : par devise. */
  resume: { aInserer: number; doublons: number; fournisseursCrees: number; totalUSD: number; total: TotalDevises };
};

/**
 * Signature anti-doublon. Une facture en dollars garde EXACTEMENT la signature d'avant (un classeur
 * déjà importé reste reconnu) ; une facture en francs y ajoute « |CDF » (100 FC ≠ 100 $).
 */
const sig = (r: { annee: number; mois: number; fournisseurNom: string; devise: "USD" | "CDF"; montant: number; numero: string | null }) =>
  `${r.annee}|${r.mois}|${normNom(r.fournisseurNom)}|${r.montant.toFixed(2)}|${r.numero ?? ""}${r.devise === "CDF" ? "|CDF" : ""}`;
/** Signature d'une facture déjà en base (lue dans sa devise). */
export const sigExistante = (e: { annee: number; mois: number; fournisseurNom: string; numero: string | null; devise: "USD" | "CDF"; montantUSD: unknown; montantCDF: unknown }) =>
  sig({ annee: e.annee, mois: e.mois, fournisseurNom: e.fournisseurNom, numero: e.numero, devise: e.devise, montant: montantsFacture(e as Parameters<typeof montantsFacture>[0]).montant });
export { sig as sigImportee };
const SELECT_SIG = { annee: true, mois: true, fournisseurNom: true, numero: true, devise: true, montantUSD: true, montantCDF: true } as const;

async function parseTous(fichiers: File[], taux: number, anneeDefaut: number): Promise<{ lignes: FactureImportee[]; erreurs: string[] }> {
  const lignes: FactureImportee[] = []; const erreurs: string[] = [];
  for (const f of fichiers) {
    const annee = Number((f.name.match(/(20\d{2})/) ?? [])[1]) || anneeDefaut;
    try { lignes.push(...(await parserClasseurFactures(await f.arrayBuffer(), annee, taux, erreurs))); }
    catch (e) { erreurs.push(`${f.name} : ${e instanceof Error ? e.message : "illisible"}`); }
  }
  return { lignes, erreurs };
}

/** Analyse le(s) classeur(s) de factures et renvoie l'aperçu (aucune écriture). */
export async function analyserFactures(fichiers: File[]): Promise<PreviewFactures> {
  const config = await prisma.config.findUnique({ where: { id: "singleton" } });
  const taux = Number(config?.tauxChangeCDF ?? 2300) || 2300;
  const anneeDefaut = config?.anneeCourante ?? anneeCouranteKinshasa();
  const { lignes, erreurs } = await parseTous(fichiers, taux, anneeDefaut);

  const fours = await prisma.fournisseur.findMany({ select: { nom: true } });
  const connus = new Set(fours.map((x) => normNom(x.nom)));
  const fournisseursCrees = [...new Set(lignes.map((l) => l.fournisseurNom))].filter((n) => !connus.has(normNom(n)));

  const existantes = await prisma.factureFournisseur.findMany({ select: SELECT_SIG });
  const vues = new Set(existantes.map(sigExistante));

  const factures: FacturePreview[] = []; let aInserer = 0, doublons = 0, total = totalVide();
  for (const r of lignes) {
    const s = sig(r); const nouvelle = !vues.has(s);
    if (nouvelle) { vues.add(s); aInserer++; total = ajouterAuTotal(total, r.devise, r.montant); } else doublons++;
    factures.push({ fournisseurNom: r.fournisseurNom, numero: r.numero, periode: `${MOIS[(r.mois || 1) - 1]} ${r.annee}`, devise: r.devise, montant: r.montant, statut: r.statut, nouvelle });
  }
  return { factures, fournisseursCrees, erreurs, resume: { aInserer, doublons, fournisseursCrees: fournisseursCrees.length, totalUSD: total.usd, total } };
}

/** Applique l'import de factures et crée un ImportBatch réversible. */
export async function appliquerFactures(fichiers: File[], libelle: string, userId: string | null): Promise<{ batchId: string; resume: PreviewFactures["resume"] }> {
  const config = await prisma.config.findUnique({ where: { id: "singleton" } });
  const taux = Number(config?.tauxChangeCDF ?? 2300) || 2300;
  const anneeDefaut = config?.anneeCourante ?? anneeCouranteKinshasa();
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
    const existantes = await tx.factureFournisseur.findMany({ select: SELECT_SIG });
    const vues = new Set(existantes.map(sigExistante));
    const aInserer = lignes.filter((r) => { const s = sig(r); if (vues.has(s)) return false; vues.add(s); return true; });
    let total = totalVide();
    for (const r of aInserer) {
      total = ajouterAuTotal(total, r.devise, r.montant);
      const fac = await tx.factureFournisseur.create({ data: {
        fournisseurId: parNom.get(normNom(r.fournisseurNom)) ?? null, fournisseurNom: r.fournisseurNom, numero: r.numero,
        date: r.date, dateEcheance: r.dateEcheance, datePaiement: r.datePaiement,
        ...donneesMontantsImportee(r),
        statut: r.statut, modePaiement: r.modePaiement, mois: r.mois, annee: r.annee,
      } });
      ops.push({ batchId: batch.id, entite: "FactureFournisseur", entiteId: fac.id, action: "CREATE", avant: Prisma.DbNull });
    }
    const resume = { aInserer: aInserer.length, doublons: lignes.length - aInserer.length, fournisseursCrees: nbFour, totalUSD: total.usd, total };
    await tx.importBatch.update({ where: { id: batch.id }, data: { resume } });
    await tx.importOperation.createMany({ data: ops });
    return { batchId: batch.id, resume };
  }, { timeout: 120000 });

  return res;
}

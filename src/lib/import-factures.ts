import "server-only";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { donneesMontantsImportee, parserClasseurFactures, type FactureImportee } from "@/lib/import-factures-excel";
import { ajouterAuTotal, formaterMontantFacture, montantsFacture, totalVide, type TotalDevises } from "@/lib/facture-devise";
import { chercherDoublonFacture, messageDoublonFacture, type FactureExistante } from "@/lib/facture-doublon";
import { fournisseurIdentique, fournisseursProches } from "@/lib/fournisseur-match";

// Import de factures fournisseurs depuis un classeur Excel, avec aperçu et journal réversible
// (écran Imports : le SEUL chemin d'import de factures depuis le 10/10/2026 — l'ancien bouton de l'écran
// Factures écrivait directement, sans aperçu ni lot annulable).
import { cleAlnum as normNom } from "./texte";
import { anneeCouranteKinshasa } from "@/lib/heure-kinshasa";
const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

/**
 * Sort d'une ligne du classeur (audit du 10/10/2026, constats 6 et 9) :
 *  - NOUVELLE : s'importe ;
 *  - DOUBLON_NUMERO : même fournisseur et même numéro qu'une facture déjà saisie (ou plus haut dans le
 *    fichier) — refus sec, jamais importée ;
 *  - A_CONFIRMER : même fournisseur, même montant (même devise) à ±14 jours d'une facture déjà saisie
 *    (ou plus haut dans le fichier) — peut-être la même ; importée seulement si la Direction la coche.
 *    Une livraison SANS numéro n'est donc plus fusionnée en silence avec une autre : elle est signalée.
 */
export type EtatFactureImport = "NOUVELLE" | "DOUBLON_NUMERO" | "A_CONFIRMER";

/** `montant` dans `devise` (une facture en francs n'est jamais convertie). `cle` : rang de la ligne dans le fichier (identifie la ligne pour la confirmer). */
export type FacturePreview = {
  cle: string; fournisseurNom: string; numero: string | null; periode: string; devise: "USD" | "CDF"; montant: number; statut: string;
  etat: EtatFactureImport; message: string | null;
};
export type PreviewFactures = {
  factures: FacturePreview[]; fournisseursCrees: string[];
  /** Fournisseur à créer qui RESSEMBLE à un fournisseur existant : « Utiliser … » ou « Créer » à décider avant d'appliquer. */
  fournisseursProches: Record<string, { id: string; nom: string }[]>;
  erreurs: string[];
  /** `totalUSD` : dollars seuls (comme avant) ; `total` : par devise. `doublons` : refusées (même numéro) ; `aConfirmer` : probables doublons. */
  resume: { aInserer: number; doublons: number; aConfirmer: number; fournisseursCrees: number; totalUSD: number; total: TotalDevises };
};
/** Choix de la Direction : pour un fournisseur à créer qui a des proches, l'identifiant à utiliser, ou « CREER ». */
export type ChoixFournisseursImport = Record<string, string>;
export type OptionsAppliquerFactures = { forcer?: string[]; choixFournisseurs?: ChoixFournisseursImport };

const SELECT_EXISTANTES = { id: true, fournisseurId: true, fournisseurNom: true, numero: true, date: true, annee: true, mois: true, devise: true, montantUSD: true, montantCDF: true, montantRegleUSD: true, montantRegleCDF: true, resteAPayerUSD: true, resteAPayerCDF: true } as const;

async function parseTous(fichiers: File[], anneeDefaut: number): Promise<{ lignes: FactureImportee[]; erreurs: string[] }> {
  const lignes: FactureImportee[] = []; const erreurs: string[] = [];
  for (const f of fichiers) {
    const annee = Number((f.name.match(/(20\d{2})/) ?? [])[1]) || anneeDefaut;
    try { lignes.push(...(await parserClasseurFactures(await f.arrayBuffer(), annee, erreurs))); }
    catch (e) { erreurs.push(`${f.name} : ${e instanceof Error ? e.message : "illisible"}`); }
  }
  return { lignes, erreurs };
}

type Client = Prisma.TransactionClient | typeof prisma;
const jour = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const texteMontant = (devise: "USD" | "CDF", m: number) => formaterMontantFacture(m, devise);

async function chargerExistantes(client: Client): Promise<FactureExistante[]> {
  return (await client.factureFournisseur.findMany({ select: SELECT_EXISTANTES })).map((e) => ({
    id: e.id, fournisseurId: e.fournisseurId, fournisseurNom: e.fournisseurNom, numero: e.numero, date: jour(e.date), annee: e.annee, mois: e.mois, devise: e.devise, montant: montantsFacture(e).montant,
  }));
}

/**
 * Classe chaque ligne : nouvelle, doublon de numéro (refus sec) ou à confirmer. Une ligne comparée aux
 * factures déjà en base ET aux lignes qui la précèdent dans le fichier (hors lignes refusées).
 * `idDe` : le fournisseur existant de ce nom (null = à créer).
 */
export function classerLignes(lignes: readonly FactureImportee[], existantes: readonly FactureExistante[], idDe: (nom: string) => string | null): { etat: EtatFactureImport; message: string | null }[] {
  const base: FactureExistante[] = [...existantes];
  return lignes.map((r, i) => {
    const comparable = { fournisseurId: idDe(r.fournisseurNom), fournisseurNom: r.fournisseurNom, numero: r.numero, date: jour(r.date), annee: r.annee, mois: r.mois, devise: r.devise, montant: r.montant };
    const d = chercherDoublonFacture(comparable, base);
    const etat: EtatFactureImport = !d ? "NOUVELLE" : d.type === "MEME_NUMERO" ? "DOUBLON_NUMERO" : "A_CONFIRMER";
    if (etat !== "DOUBLON_NUMERO") base.push({ id: `import-${i}`, ...comparable });
    return { etat, message: d ? messageDoublonFacture(d, texteMontant) : null };
  });
}

/** Analyse le(s) classeur(s) de factures et renvoie l'aperçu (aucune écriture). */
export async function analyserFactures(fichiers: File[]): Promise<PreviewFactures> {
  const config = await prisma.config.findUnique({ where: { id: "singleton" } });
  const anneeDefaut = config?.anneeCourante ?? anneeCouranteKinshasa();
  const { lignes, erreurs } = await parseTous(fichiers, anneeDefaut);

  const fours = await prisma.fournisseur.findMany({ select: { id: true, nom: true } });
  const parNom = new Map(fours.map((x) => [normNom(x.nom), x.id]));
  const existantes = await chargerExistantes(prisma);
  const etats = classerLignes(lignes, existantes, (nom) => parNom.get(normNom(nom)) ?? null);

  const factures: FacturePreview[] = []; let aInserer = 0, doublons = 0, aConfirmer = 0, total = totalVide();
  lignes.forEach((r, i) => {
    const { etat, message } = etats[i];
    if (etat === "NOUVELLE") { aInserer++; total = ajouterAuTotal(total, r.devise, r.montant); }
    else if (etat === "DOUBLON_NUMERO") doublons++;
    else aConfirmer++;
    factures.push({ cle: String(i), fournisseurNom: r.fournisseurNom, numero: r.numero, periode: `${MOIS[(r.mois || 1) - 1]} ${r.annee}`, devise: r.devise, montant: r.montant, statut: r.statut, etat, message });
  });
  // Fournisseurs à créer = ceux des lignes qui peuvent s'importer ; chacun qui RESSEMBLE à un fournisseur existant se décide à l'écran.
  const inserables = lignes.filter((_, i) => etats[i].etat !== "DOUBLON_NUMERO");
  const fournisseursCrees = [...new Set(inserables.map((l) => l.fournisseurNom))].filter((n) => !parNom.has(normNom(n)));
  const fournisseursProchesParNom: PreviewFactures["fournisseursProches"] = {};
  for (const nom of fournisseursCrees) {
    const p = fournisseursProches(nom, fours);
    if (p.length > 0) fournisseursProchesParNom[nom] = p.map((f) => ({ id: f.id, nom: f.nom }));
  }
  return { factures, fournisseursCrees, fournisseursProches: fournisseursProchesParNom, erreurs, resume: { aInserer, doublons, aConfirmer, fournisseursCrees: fournisseursCrees.length, totalUSD: total.usd, total } };
}

/**
 * Applique l'import de factures et crée un ImportBatch réversible. `forcer` : rangs (`cle`) des lignes « à
 * confirmer » que la Direction a cochées. Les lignes au même numéro qu'une facture du même fournisseur ne
 * s'importent jamais. Un fournisseur à créer qui ressemble à un existant exige un choix (`choixFournisseurs`).
 */
export async function appliquerFactures(fichiers: File[], libelle: string, userId: string | null, { forcer = [], choixFournisseurs = {} }: OptionsAppliquerFactures = {}): Promise<{ batchId: string; resume: PreviewFactures["resume"] }> {
  const config = await prisma.config.findUnique({ where: { id: "singleton" } });
  const anneeDefaut = config?.anneeCourante ?? anneeCouranteKinshasa();
  const { lignes } = await parseTous(fichiers, anneeDefaut);
  const confirmees = new Set(forcer.map(String));

  const res = await prisma.$transaction(async (tx) => {
    const fours = await tx.fournisseur.findMany({ select: { id: true, nom: true } });
    const parNom = new Map(fours.map((x) => [normNom(x.nom), x.id]));
    // Choix de la Direction pour les fournisseurs qui ressemblent à un existant : « Utiliser … » = ce fournisseur, « CREER » = un nouveau.
    const choisi = new Map<string, string>(); // nom du fichier → id existant
    const aDecider: string[] = [];
    const nomsAbsents = [...new Set(lignes.map((l) => l.fournisseurNom))].filter((n) => !parNom.has(normNom(n)));
    for (const nom of nomsAbsents) {
      const p = fournisseursProches(nom, fours);
      if (p.length === 0) continue;
      const c = choixFournisseurs[nom];
      if (c && p.some((f) => f.id === c)) choisi.set(nom, c);
      else if (c !== "CREER") aDecider.push(`« ${nom} » → ${p.map((f) => `« ${f.nom} »`).join(", ")}`);
    }
    if (aDecider.length > 0) throw new Error(`Fournisseur déjà connu sous un nom proche : choisissez « Utiliser … » ou « Créer » pour ${aDecider.length > 1 ? "chacun" : "ce fournisseur"} ; rien n'a été importé. ${aDecider.join(" ; ")}.`);

    const idDe = (nom: string) => parNom.get(normNom(nom)) ?? choisi.get(nom) ?? null;
    const etats = classerLignes(lignes, await chargerExistantes(tx), idDe);
    const aInserer = lignes.filter((_, i) => etats[i].etat === "NOUVELLE" || (etats[i].etat === "A_CONFIRMER" && confirmees.has(String(i))));
    const aConfirmerNonCochees = etats.filter((e, i) => e.etat === "A_CONFIRMER" && !confirmees.has(String(i))).length;
    const doublons = etats.filter((e) => e.etat === "DOUBLON_NUMERO").length;

    const batch = await tx.importBatch.create({ data: { type: "FACTURES", libelle, statut: "APPLIQUE", creeParId: userId } });
    const ops: Prisma.ImportOperationCreateManyInput[] = [];

    // Fournisseurs manquants : seulement ceux des lignes importées.
    let nbFour = 0;
    for (const nom of [...new Set(aInserer.map((l) => l.fournisseurNom))]) {
      if (idDe(nom)) continue;
      const cree = await tx.fournisseur.create({ data: { nom, pays: "République démocratique du Congo" } });
      parNom.set(normNom(nom), cree.id); nbFour++;
      ops.push({ batchId: batch.id, entite: "Fournisseur", entiteId: cree.id, action: "CREATE", avant: Prisma.DbNull });
    }

    let total = totalVide();
    for (const r of aInserer) {
      total = ajouterAuTotal(total, r.devise, r.montant);
      const fac = await tx.factureFournisseur.create({ data: {
        fournisseurId: idDe(r.fournisseurNom), fournisseurNom: r.fournisseurNom, numero: r.numero,
        date: r.date, dateEcheance: r.dateEcheance, datePaiement: r.datePaiement,
        ...donneesMontantsImportee(r),
        statut: r.statut, modePaiement: r.modePaiement, mois: r.mois, annee: r.annee,
      } });
      ops.push({ batchId: batch.id, entite: "FactureFournisseur", entiteId: fac.id, action: "CREATE", avant: Prisma.DbNull });
    }
    const resume = { aInserer: aInserer.length, doublons, aConfirmer: aConfirmerNonCochees, fournisseursCrees: nbFour, totalUSD: total.usd, total };
    await tx.importBatch.update({ where: { id: batch.id }, data: { resume } });
    await tx.importOperation.createMany({ data: ops });
    return { batchId: batch.id, resume };
  }, { timeout: 120000 });

  return res;
}

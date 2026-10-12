// DONNÉES D'UNE DEMANDE DE CRÉATION DE FICHE — module PUR (ni base, ni `server-only`).
// `donnees` = les valeurs saisies au formulaire « Nouvel employé » (lecture de `toEmployeeInput`), stockées en
// JSON (dates en ISO). Ce module les relit en valeurs d'écriture et les met en lignes lisibles pour « À valider ».

import { CHAMPS_SENSIBLES, canonique, libelleChamp, libelleValeur, valeurRefusee } from "@/lib/fiche-sensible";

export type DonneesCreation = {
  matricule: string; nom: string; sexe: string; etatCivil: string; poste: string; secteur: string;
  categorie: "BRIGADE" | "BACKOFFICE"; categorieProfessionnelle: string | null;
  salaireMensuel: number; transportJourCDF: number; transportMoisCDF: number; transportMoisUSD: number; cnssMontant: number;
  enfants: number; type: "NATIONAL" | "EXPATRIE"; dateEmbauche: Date | string; contrat: string;
  heuresParJour: number; heuresHebdomadaires: number; fraisMedicauxMoisCourant: number;
  idExterneIVMS: string | null; dateNaissance: Date | string | null; telephone: string | null; email: string | null; adresse: string | null;
  banque: string | null; compteBancaire: string | null; mobileMoney: string | null;
  modePaiement: "ESPECES" | "VIREMENT" | "MOBILE_MONEY";
};

/** Contrôles de la saisie (les mêmes à la demande et à l'approbation) : message lisible ou null. */
export function controlerDonneesCreation(d: Partial<DonneesCreation>): string | null {
  if (!d.nom || !String(d.nom).trim()) return "Le nom est obligatoire.";
  const date = new Date(d.dateEmbauche as string);
  if (!d.dateEmbauche || Number.isNaN(date.getTime())) return "Date d'embauche invalide.";
  const refus = CHAMPS_SENSIBLES.map((c) => valeurRefusee(c, canonique(c, (d as Record<string, unknown>)[c]))).filter((m): m is string => m !== null);
  return refus.length > 0 ? refus.join(" ") : null;
}

/** JSON stocké → données prêtes pour `employee.create` (dates relues). */
export function donneesPourEcriture(json: unknown): DonneesCreation {
  if (typeof json !== "object" || json === null || Array.isArray(json)) throw new Error("Demande de création illisible.");
  const d = json as DonneesCreation;
  return {
    ...d,
    dateEmbauche: new Date(d.dateEmbauche),
    dateNaissance: d.dateNaissance ? new Date(d.dateNaissance) : null,
  };
}

const AUTRES: [keyof DonneesCreation, string][] = [
  ["matricule", "Matricule"], ["sexe", "Sexe"], ["etatCivil", "État civil"], ["poste", "Poste"], ["secteur", "Secteur"],
  ["telephone", "Téléphone"], ["email", "E-mail"], ["adresse", "Adresse"], ["idExterneIVMS", "ID pointeuse IVMS"],
];

/** Toutes les valeurs saisies, une ligne chacune (« Salaire mensuel : 350,00 $ »). Les champs vides sont omis. */
export function lignesCreation(json: unknown): string[] {
  let d: DonneesCreation;
  try { d = donneesPourEcriture(json); } catch { return ["Demande illisible : refusez-la."]; }
  const out: string[] = [];
  out.push(d.matricule ? `Matricule : ${d.matricule}` : "Matricule : attribué à l'approbation");
  for (const [k, lib] of AUTRES) {
    if (k === "matricule") continue;
    const v = d[k];
    if (v !== null && v !== undefined && String(v).trim() !== "") out.push(`${lib} : ${String(v)}`);
  }
  if (d.dateNaissance) out.push(`Date de naissance : ${new Date(d.dateNaissance).toISOString().slice(0, 10).split("-").reverse().join("/")}`);
  for (const c of CHAMPS_SENSIBLES) {
    const cano = canonique(c, (d as Record<string, unknown>)[c]);
    if (cano === null || (cano === "0" && c !== "salaireMensuel")) continue;
    out.push(`${libelleChamp(c)} : ${libelleValeur(c, cano)}`);
  }
  return out;
}

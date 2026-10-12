// CHAMPS SENSIBLES DE LA FICHE SALARIÉ — module PUR (ni base, ni `server-only`), importable à l'écran.
//
// Décision de Sacha (2026-10-12) : « Le RH doit pouvoir [changer salaire, date d'embauche, contrat,
// frais médicaux] et le faire ensuite valider par la direction. Il faut toujours penser en ce sens,
// la direction valide les changements effectués par les autres rôles. » Un champ est SENSIBLE s'il
// change la paie, le contrat ou l'endroit où le salaire est versé. Hors Direction, sa modification
// ne s'applique pas : elle crée une demande « À valider » (lib/demandes-fiche.ts).
//
// Pourquoi chacun (relevé dans payroll.ts, paie-batch.ts, bulletin-live.ts, paie-reference*.ts,
// bulletin-fiche-figee.ts, pdf/contrat.tsx) :
//   salaireMensuel ............ base de toute la paie (taux du contrat, solde de tout compte) ;
//   heuresParJour / heuresHebdomadaires  seuils des heures supp. et référence d'heures (paie-reference) ;
//   transportJourCDF / transportMoisCDF / transportMoisUSD  transport versé (brigade au jour, back-office au mois) ;
//   fraisMedicauxMoisCourant .. remboursement ajouté au net du mois ;
//   enfants ................... allocations familiales et IPR (personnes à charge) ;
//   cnssMontant ............... affiliation CNSS saisie sur la fiche ;
//   dateEmbauche .............. ancienneté (congés acquis), mois d'embauche (repli de la paie) ;
//   contrat ................... régime de paie (stage, journalier, intérim hors paie, congés) ;
//   type (national/expatrié) .. nationalité inscrite au contrat de travail ;
//   categorie (brigade/back-office)  choisit le moteur de paie (aux heures ou au salaire fixe) ;
//   categorieProfessionnelle .. classement du Code du travail, imprimé et figé sur le bulletin ;
//   modePaiement / banque / compteBancaire / mobileMoney  OÙ le salaire est versé (figés au bulletin,
//                               pré-remplis au paiement) : un compte changé détourne un salaire.
// Ne sont PAS sensibles (s'enregistrent directement) : identité (nom, sexe, état civil, naissance),
// coordonnées, matricule, poste, secteur, identifiant de pointeuse — la paie ne les lit pas (les
// heures importées passent elles-mêmes par la grille des présences).

export const CHAMPS_SENSIBLES = [
  "salaireMensuel", "heuresParJour", "heuresHebdomadaires",
  "transportJourCDF", "transportMoisCDF", "transportMoisUSD", "fraisMedicauxMoisCourant", "enfants", "cnssMontant",
  "dateEmbauche", "contrat", "type", "categorie", "categorieProfessionnelle",
  "modePaiement", "banque", "compteBancaire", "mobileMoney",
] as const;
export type ChampSensible = (typeof CHAMPS_SENSIBLES)[number];
/** Champs qu'une demande peut porter : les sensibles, et le poste qui accompagne « Changer le salaire ». */
export type ChampDemande = ChampSensible | "poste";

type Genre = "usd" | "cdf" | "heures" | "entier" | "date" | "texte";
const DEF: Record<ChampDemande, { libelle: string; genre: Genre; libelles?: Record<string, string> }> = {
  salaireMensuel: { libelle: "Salaire mensuel", genre: "usd" },
  heuresParJour: { libelle: "Heures / jour", genre: "heures" },
  heuresHebdomadaires: { libelle: "Heures / semaine", genre: "heures" },
  transportJourCDF: { libelle: "Transport / jour", genre: "cdf" },
  transportMoisCDF: { libelle: "Transport / mois (CDF)", genre: "cdf" },
  transportMoisUSD: { libelle: "Transport / mois ($)", genre: "usd" },
  fraisMedicauxMoisCourant: { libelle: "Frais médicaux du mois", genre: "usd" },
  enfants: { libelle: "Enfants à charge", genre: "entier" },
  cnssMontant: { libelle: "CNSS", genre: "usd" },
  dateEmbauche: { libelle: "Date d'embauche", genre: "date" },
  contrat: { libelle: "Type de contrat", genre: "texte" },
  type: { libelle: "National / expatrié", genre: "texte", libelles: { NATIONAL: "National", EXPATRIE: "Expatrié" } },
  categorie: { libelle: "Catégorie", genre: "texte", libelles: { BRIGADE: "Brigade", BACKOFFICE: "Back-office" } },
  categorieProfessionnelle: { libelle: "Catégorie professionnelle", genre: "texte" },
  modePaiement: { libelle: "Moyen de paiement", genre: "texte", libelles: { ESPECES: "Espèces", VIREMENT: "Virement bancaire", MOBILE_MONEY: "Mobile Money" } },
  banque: { libelle: "Banque", genre: "texte" },
  compteBancaire: { libelle: "Compte bancaire", genre: "texte" },
  mobileMoney: { libelle: "Mobile Money", genre: "texte" },
  poste: { libelle: "Poste", genre: "texte" },
};

export const estChampSensible = (c: string): c is ChampSensible => (CHAMPS_SENSIBLES as readonly string[]).includes(c);
export const estChampDemande = (c: string): c is ChampDemande => c in DEF;
export const libelleChamp = (c: ChampDemande) => DEF[c].libelle;

/** Valeur CANONIQUE (texte comparable) d'un champ : nombres au centime, dates « AAAA-MM-JJ », vide → null. */
export function canonique(champ: ChampDemande, v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const g = DEF[champ].genre;
  if (g === "date") {
    const d = v instanceof Date ? v : new Date(String(v));
    return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  if (g === "texte") { const t = String(v).trim(); return t === "" ? null : t; }
  const n = Number(typeof v === "object" ? String(v) : v);
  if (!Number.isFinite(n)) return null;
  return g === "entier" ? String(Math.round(n)) : String(Math.round(n * 100) / 100);
}

/** Valeur à écrire en base depuis la forme canonique. */
export function versDonnee(champ: ChampDemande, c: string | null): unknown {
  const g = DEF[champ].genre;
  if (c === null) return g === "texte" ? null : 0;
  if (g === "date") return new Date(`${c}T00:00:00.000Z`);
  if (g === "texte") return c;
  return Number(c);
}

const nf = (min: number, max: number) => new Intl.NumberFormat("fr-FR", { minimumFractionDigits: min, maximumFractionDigits: max });
const espaces = (s: string) => s.replace(/[  ]/g, " ");
/** Valeur lisible (« 350,00 $ », « 12 000 FC », « 8 h », « 01/03/2024 », « Brigade », « — »). */
export function libelleValeur(champ: ChampDemande, c: string | null): string {
  if (c === null) return "—";
  const d = DEF[champ];
  switch (d.genre) {
    case "usd": return `${espaces(nf(2, 2).format(Number(c)))} $`;
    case "cdf": return `${espaces(nf(0, 0).format(Number(c)))} FC`;
    case "heures": return `${espaces(nf(0, 2).format(Number(c)))} h`;
    case "entier": return c;
    case "date": return `${c.slice(8, 10)}/${c.slice(5, 7)}/${c.slice(0, 4)}`;
    default: return d.libelles?.[c] ?? c;
  }
}

export type Changement = { champ: ChampDemande; avant: string | null; apres: string | null };

/** Les champs dont la valeur proposée diffère de la fiche (valeurs canoniques). */
export function changementsProposes(fiche: Record<string, unknown>, proposes: Partial<Record<ChampDemande, unknown>>): Changement[] {
  const out: Changement[] = [];
  for (const [champ, v] of Object.entries(proposes) as [ChampDemande, unknown][]) {
    if (!estChampDemande(champ)) continue;
    const avant = canonique(champ, fiche[champ]);
    const apres = canonique(champ, v);
    if (avant !== apres) out.push({ champ, avant, apres });
  }
  return out;
}

/** Relit une liste de changements stockée en JSON ; refuse ce qui n'est pas un champ connu. */
export function lireChangements(json: unknown): Changement[] {
  if (!Array.isArray(json)) throw new Error("Demande illisible (changements absents).");
  return json.map((x) => {
    const o = x as { champ?: unknown; avant?: unknown; apres?: unknown };
    if (typeof o?.champ !== "string" || !estChampDemande(o.champ)) throw new Error("Demande illisible (champ inconnu).");
    const val = (v: unknown) => (v === null || v === undefined ? null : String(v));
    return { champ: o.champ, avant: val(o.avant), apres: val(o.apres) };
  });
}

/** « Salaire mensuel : 300,00 $ → 350,00 $ ». */
export const ligneChangement = (c: Changement) => `${libelleChamp(c.champ)} : ${libelleValeur(c.champ, c.avant)} → ${libelleValeur(c.champ, c.apres)}`;

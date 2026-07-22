/**
 * Seed des paramètres légaux — exercice 2026 (RDC).
 *
 * ⚠️ TOUTES ces valeurs sont des AMORCES marquées « À VALIDER » : elles doivent être
 * confirmées par un comptable/juriste congolais avant tout usage réel, puis validées
 * par le directeur dans Paramètres (seul l'ADMIN peut les modifier).
 *
 * Usage : npx tsx scripts/seed-legal-2026.ts
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const PARAMS: {
  cle: string;
  valeur: number | null;
  unite: string;
  libelle: string;
  source?: string;
  commentaire?: string;
}[] = [
  // --- CNSS (Décret n°18/041 du 24/11/2018) ---
  { cle: "cnss_salarie", valeur: 0.05, unite: "taux", libelle: "CNSS — retenue salariale (pensions)", source: "Décret n°18/041 du 24/11/2018" },
  { cle: "cnss_patronal_pensions", valeur: 0.05, unite: "taux", libelle: "CNSS patronal — branche pensions", source: "Décret n°18/041" },
  { cle: "cnss_patronal_risques", valeur: 0.015, unite: "taux", libelle: "CNSS patronal — risques professionnels", source: "Décret n°18/041" },
  { cle: "cnss_patronal_famille", valeur: 0.065, unite: "taux", libelle: "CNSS patronal — prestations familiales", source: "Décret n°18/041" },
  { cle: "plafond_cnss_mensuel_cdf", valeur: null, unite: "CDF", libelle: "Plafond mensuel de l'assiette CNSS", commentaire: "Montant exact inconnu (arrêté ministériel) — laisser vide tant que non confirmé ; vide = pas de plafond appliqué" },

  // --- IPR (barème DGI) ---
  { cle: "ipr_plancher_mensuel_cdf", valeur: 2000, unite: "CDF", libelle: "IPR — plancher mensuel", source: "DGI" },
  { cle: "ipr_plafond_taux", valeur: 0.30, unite: "taux", libelle: "IPR — plafond (max % du revenu imposable)", source: "DGI" },
  { cle: "ipr_reduction_famille_taux", valeur: 0.02, unite: "taux", libelle: "IPR — réduction par personne à charge", commentaire: "Souvent citée à 2%/personne — taux, plafond et ordre d'application vs plancher À VALIDER" },
  { cle: "ipr_reduction_famille_max", valeur: 9, unite: "personnes", libelle: "IPR — nombre max de personnes à charge" },
  { cle: "ipr_base", valeur: 2, unite: "choix", libelle: "IPR — base imposable (1=brut, 2=brut−CNSS, 3=brut−CNSS−frais pro)", commentaire: "Point non tranché — défaut 2 (brut − CNSS salariale) À VALIDER par un comptable" },

  // --- INPP / ONEM (sources secondaires) ---
  { cle: "inpp_taux", valeur: 0.03, unite: "taux", libelle: "INPP — charge patronale (effectif 1-50)", commentaire: "3% pour 1-50 travailleurs ; 2% (51-300) ; 1% (>300) — source secondaire À VALIDER" },
  { cle: "onem_taux", valeur: 0.002, unite: "taux", libelle: "ONEM — charge patronale", commentaire: "0,2% — source secondaire À VALIDER" },

  // --- Heures supplémentaires (règles de l'employeur) ---
  { cle: "hs_seuil_hebdo_h", valeur: 6, unite: "heures", libelle: "HS — seuil hebdomadaire de la 1ère tranche", commentaire: "Les N premières heures supp. de la semaine sont à la majoration tranche 1" },
  { cle: "hs_maj_tranche1", valeur: 0.30, unite: "taux", libelle: "HS — majoration tranche 1 (6 premières h/semaine)" },
  { cle: "hs_maj_tranche2", valeur: 0.60, unite: "taux", libelle: "HS — majoration tranche 2 (au-delà)" },
  { cle: "hs_maj_dimanche_ferie", valeur: 1.0, unite: "taux", libelle: "HS — majoration dimanche et jours fériés (paiement double)" },

  // --- Divers paie (règles internes existantes) ---
  { cle: "alloc_familiale_par_enfant_usd", valeur: 1.5, unite: "USD", libelle: "Allocation familiale par enfant (règle interne, ajoutée au net)", commentaire: "Héritée du fichier Excel PEF — les prestations familiales CNSS étant patronales, ce complément interne est À VALIDER" },
  { cle: "jours_ouvrables_mois", valeur: 26, unite: "jours", libelle: "Jours ouvrables par mois (base salaire journalier)" },
  { cle: "droits_conges_annuel", valeur: 18, unite: "jours", libelle: "Droits de congés annuels (jours ouvrables)" },

  // --- Interprétation des salaires saisis (2026-07-22) ---
  {
    cle: "salaires_saisis_en_net",
    valeur: 1,
    unite: "booléen (0/1)",
    libelle: "Salaires saisis interprétés comme des NETS (reconstitution automatique du brut)",
    commentaire:
      "À VALIDER — quand actif (1), les salaires saisis sur la fiche employé (salaire mensuel) sont " +
      "interprétés comme des NETS cibles (take-home) et le brut de base est reconstitué par le moteur " +
      "de paie (CNSS salariale + IPR à la charge du salarié) avant tout calcul de cotisations/impôt. " +
      "Quand inactif (0) ou absent, comportement historique inchangé : la valeur saisie est un BRUT. " +
      "NOTE : le chargement des paramètres (chargerParametresPaie) applique un défaut OFF si cette " +
      "clé est absente de l'exercice — ce seed la fixe à 1 pour les NOUVELLES installations ; une " +
      "base de prod existante n'est jamais basculée automatiquement (upsert `update: {}` ne réécrit " +
      "jamais une valeur déjà présente).",
  },
];

// Barème IPR DGI — tranches ANNUELLES en CDF.
const TRANCHES_IPR: { ordre: number; plafondAnnuelCDF: number | null; taux: number }[] = [
  { ordre: 1, plafondAnnuelCDF: 1_944_000, taux: 0.03 },
  { ordre: 2, plafondAnnuelCDF: 21_600_000, taux: 0.15 },
  { ordre: 3, plafondAnnuelCDF: 43_200_000, taux: 0.3 },
  { ordre: 4, plafondAnnuelCDF: null, taux: 0.4 },
];

async function main() {
  const exercice = await prisma.exerciceFiscal.upsert({
    where: { annee: 2026 },
    update: { actif: true },
    create: { annee: 2026, actif: true },
  });

  for (const p of PARAMS) {
    await prisma.parametreLegal.upsert({
      where: { exerciceId_cle: { exerciceId: exercice.id, cle: p.cle } },
      update: {}, // ne jamais écraser une valeur déjà ajustée par le directeur
      create: {
        exerciceId: exercice.id,
        cle: p.cle,
        valeur: p.valeur,
        unite: p.unite,
        libelle: p.libelle,
        source: p.source,
        commentaire: p.commentaire,
        statutValidation: "A_VALIDER",
      },
    });
  }

  for (const t of TRANCHES_IPR) {
    await prisma.trancheIprCDF.upsert({
      where: { exerciceId_ordre: { exerciceId: exercice.id, ordre: t.ordre } },
      update: {},
      create: {
        exerciceId: exercice.id,
        ordre: t.ordre,
        plafondAnnuelCDF: t.plafondAnnuelCDF,
        taux: t.taux,
        statutValidation: "A_VALIDER",
      },
    });
  }

  console.log(
    `Exercice 2026 : ${PARAMS.length} paramètres légaux + ${TRANCHES_IPR.length} tranches IPR chargés (statut À VALIDER).`
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

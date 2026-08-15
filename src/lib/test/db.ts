import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/**
 * Démarre un Postgres ÉPHÉMÈRE en local (aucun Docker, aucun contact avec Supabase/prod),
 * applique le schéma Prisma (public + stock) via `prisma db push`, et renvoie un client Prisma
 * branché dessus. Tout est jeté par `fermer()`. Réservé aux tests d'intégration.
 *
 * `url` est également renvoyée : certains tests ont besoin d'ouvrir LEUR PROPRE connexion sur la
 * même base (connexion dédiée, options de pool particulières) sans passer par `prisma`.
 */
export async function creerBaseTest(): Promise<{ prisma: PrismaClient; url: string; fermer: () => Promise<void> }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pef-test-"));
  const port = 55000 + Math.floor(Math.random() * 4000); // évite les collisions entre fichiers de test
  const pg = new EmbeddedPostgres({ databaseDir: dir, user: "postgres", password: "postgres", port, persistent: false });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("testdb");
  const url = `postgresql://postgres:postgres@localhost:${port}/testdb`;
  execSync(`npx prisma db push --url "${url}" --accept-data-loss`, { stdio: "ignore" });
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  const fermer = async () => {
    await prisma.$disconnect();
    await pg.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  };
  return { prisma, url, fermer };
}

/**
 * Seed des paramètres légaux (exercice fiscal + ParametreLegal + barème IPR) pour les tests
 * d'intégration du moteur de paie. Copie des valeurs de `scripts/seed-legal-2026.ts` (mêmes
 * clés/valeurs que la production, exercice actif par défaut) — réservé aux tests : les tests
 * qui en ont besoin appellent ensuite `chargerParametresPaie()` pour lire les valeurs RÉELLEMENT
 * seedées plutôt que de les recopier une 2e fois en dur dans les assertions.
 */
export async function seedParametresLegaux(prisma: PrismaClient, annee = 2026) {
  const exercice = await prisma.exerciceFiscal.create({ data: { annee, actif: true } });
  await prisma.parametreLegal.createMany({
    data: [
      { exerciceId: exercice.id, cle: "cnss_salarie", valeur: 0.05, unite: "taux", libelle: "CNSS — retenue salariale" },
      { exerciceId: exercice.id, cle: "cnss_patronal_pensions", valeur: 0.05, unite: "taux", libelle: "CNSS patronal — pensions" },
      { exerciceId: exercice.id, cle: "cnss_patronal_risques", valeur: 0.015, unite: "taux", libelle: "CNSS patronal — risques" },
      { exerciceId: exercice.id, cle: "cnss_patronal_famille", valeur: 0.065, unite: "taux", libelle: "CNSS patronal — famille" },
      { exerciceId: exercice.id, cle: "plafond_cnss_mensuel_cdf", valeur: null, unite: "CDF", libelle: "Plafond CNSS mensuel" },
      { exerciceId: exercice.id, cle: "ipr_plancher_mensuel_cdf", valeur: 2000, unite: "CDF", libelle: "IPR — plancher mensuel" },
      { exerciceId: exercice.id, cle: "ipr_plafond_taux", valeur: 0.3, unite: "taux", libelle: "IPR — plafond" },
      { exerciceId: exercice.id, cle: "ipr_reduction_famille_taux", valeur: 0.02, unite: "taux", libelle: "IPR — réduction famille" },
      { exerciceId: exercice.id, cle: "ipr_reduction_famille_max", valeur: 9, unite: "personnes", libelle: "IPR — max personnes à charge" },
      { exerciceId: exercice.id, cle: "ipr_base", valeur: 2, unite: "choix", libelle: "IPR — base imposable" },
      { exerciceId: exercice.id, cle: "inpp_taux", valeur: 0.03, unite: "taux", libelle: "INPP" },
      { exerciceId: exercice.id, cle: "onem_taux", valeur: 0.002, unite: "taux", libelle: "ONEM" },
      { exerciceId: exercice.id, cle: "hs_seuil_hebdo_h", valeur: 6, unite: "heures", libelle: "HS — seuil hebdo tranche 1" },
      { exerciceId: exercice.id, cle: "hs_maj_tranche1", valeur: 0.3, unite: "taux", libelle: "HS — majoration tranche 1" },
      { exerciceId: exercice.id, cle: "hs_maj_tranche2", valeur: 0.6, unite: "taux", libelle: "HS — majoration tranche 2" },
      { exerciceId: exercice.id, cle: "hs_maj_dimanche_ferie", valeur: 1.0, unite: "taux", libelle: "HS — majoration dimanche/férié" },
      { exerciceId: exercice.id, cle: "alloc_familiale_par_enfant_usd", valeur: 1.5, unite: "USD", libelle: "Allocation familiale/enfant" },
      { exerciceId: exercice.id, cle: "jours_ouvrables_mois", valeur: 26, unite: "jours", libelle: "Jours ouvrables/mois" },
      { exerciceId: exercice.id, cle: "droits_conges_annuel", valeur: 18, unite: "jours", libelle: "Droits congés annuel" },
    ],
  });
  await prisma.trancheIprCDF.createMany({
    data: [
      { exerciceId: exercice.id, ordre: 1, plafondAnnuelCDF: 1_944_000, taux: 0.03 },
      { exerciceId: exercice.id, ordre: 2, plafondAnnuelCDF: 21_600_000, taux: 0.15 },
      { exerciceId: exercice.id, ordre: 3, plafondAnnuelCDF: 43_200_000, taux: 0.3 },
      { exerciceId: exercice.id, ordre: 4, plafondAnnuelCDF: null, taux: 0.4 },
    ],
  });
  return exercice;
}

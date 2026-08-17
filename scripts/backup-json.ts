/**
 * Sauvegarde logique de secours SANS pg_dump : exporte toutes les tables (Prisma) en JSON.
 * Filet de sécurité immédiat tant que pg_dump/libpq n'est pas installé.
 *
 * ⚠️⚠️ SECRET DE PREMIÈRE CATÉGORIE ⚠️⚠️ Ce fichier contient TOUTES les données de paie (PII,
 * salaires) ET, depuis l'ajout du schéma `auth`, les MOTS DE PASSE CHIFFRÉS des comptes de
 * connexion (`auth.users.encrypted_password`). Quiconque obtient ce fichier peut, avec un peu de
 * travail hors-ligne, tenter de casser ces mots de passe. Ne JAMAIS le déposer sur un cloud
 * public, un dossier synchronisé (iCloud/Dropbox/OneDrive), ou le transmettre par messagerie/mail
 * en clair. À conserver uniquement en local, hors de tout dossier synchronisé.
 *
 * Résilience : le schéma LOCAL (celui du dépôt) peut être en avance sur la base CIBLE pendant
 * toute la durée d'un développement (migration écrite mais pas encore déployée) — c'est
 * précisément le moment où la sauvegarde est la plus utile. Une table absente de la cible
 * (P2021) ou une colonne absente (P2022) est donc IGNORÉE et CONSIGNÉE, jamais fatale : le
 * script continue avec les autres tables et écrit quand même le fichier. Toute autre erreur
 * (connexion perdue, authentification refusée...) reste fatale — on n'écrit RIEN plutôt que
 * d'écrire un fichier tronqué en silence. La même règle s'applique au schéma `auth` : sur un
 * PostgreSQL ordinaire (tous nos tests, toute base hors Supabase) ce schéma n'existe pas — ce
 * n'est PAS fatal, c'est consigné dans `meta.tablesIgnorees` comme les autres.
 */
import "dotenv/config";
import { mkdirSync, writeFileSync, readdirSync, statSync, readFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

export const replacer = (_k: string, v: unknown) =>
  typeof v === "bigint" ? v.toString()
  : v instanceof Buffer ? v.toString("base64")
  : v;

/** Codes Prisma propres à UNE table (schéma local en avance/en retard sur la base cible) — jamais
 *  le signe d'une panne globale. Tout le reste (perte de connexion, authentification refusée,
 *  timeout...) n'est PAS dans cette liste et reste fatal. */
const CODES_TABLE_TOLERABLES: Record<string, string> = {
  P2021: "table absente de la base cible (schéma local en avance — migration pas encore déployée)",
  P2022: "colonne absente de la base cible (schéma local en avance — migration pas encore déployée)",
};

export type TableIgnoree = { table: string; code: string; raison: string };

/**
 * Interroge chaque modèle de `models` sur `prisma`. Une erreur PROPRE à une table (cf.
 * `CODES_TABLE_TOLERABLES`) est avalée, nommée dans `tablesIgnorees`, et la collecte continue.
 * Toute autre erreur remonte immédiatement (fatale) : c'est au *caller* de ne PAS écrire de
 * fichier dans ce cas.
 */
export async function collecterTables(
  prisma: PrismaClient,
  models: string[]
): Promise<{ out: Record<string, unknown[]>; tablesIgnorees: TableIgnoree[]; totalRows: number }> {
  const out: Record<string, unknown[]> = {};
  const tablesIgnorees: TableIgnoree[] = [];
  let totalRows = 0;
  for (const name of models) {
    const delegate = (prisma as unknown as Record<string, { findMany: (a: unknown) => Promise<unknown[]> }>)[
      name.charAt(0).toLowerCase() + name.slice(1)
    ];
    if (!delegate?.findMany) continue;
    try {
      const rows = await delegate.findMany({});
      out[name] = rows;
      totalRows += rows.length;
      console.log(`  ${name}: ${rows.length}`);
    } catch (e) {
      const code = e instanceof Prisma.PrismaClientKnownRequestError ? e.code : undefined;
      const raison = code ? CODES_TABLE_TOLERABLES[code] : undefined;
      if (!raison) throw e; // erreur globale (connexion, auth...) — fatale, n'écrit RIEN
      tablesIgnorees.push({ table: name, code: code!, raison });
      console.warn(`  ${name}: IGNORÉE — ${raison}`);
    }
  }
  return { out, tablesIgnorees, totalRows };
}

/** Colonnes exactement celles réinjectées par `restaurer-depuis-backup.ts` (rien de plus) : pas
 *  de sur-collecte de colonnes GoTrue internes qu'on ne sait pas restaurer. Les colonnes « jeton »
 *  (confirmation_token, recovery_token...) ne sont volontairement PAS exportées : la restauration
 *  les remet à '' de toute façon (cf. restaurer-depuis-backup.ts) et elles ne portent aucune
 *  information utile hors GoTrue lui-même. */
const COLONNES_AUTH_USERS = [
  "id", "email", "encrypted_password", "email_confirmed_at", "created_at", "updated_at",
  "raw_app_meta_data", "raw_user_meta_data", "aud", "role",
];
const COLONNES_AUTH_IDENTITIES = [
  "id", "provider_id", "user_id", "identity_data", "provider", "last_sign_in_at", "created_at", "updated_at",
];

export type AuthDump = { users: Record<string, unknown>[]; identities: Record<string, unknown>[] };

/** Le schéma `auth` (Supabase/GoTrue) n'existe pas sur un PostgreSQL ordinaire — c'est le cas de
 *  TOUS nos tests et de toute base hors Supabase. Une requête sur `auth.users`/`auth.identities`
 *  y échoue en `P2010` (requête brute) avec une cause `TableDoesNotExist` (SQLSTATE 42P01) : ce
 *  n'est pas une panne, c'est l'absence attendue du schéma — jamais fatal, jamais silencieux. */
function estSchemaAuthAbsent(e: unknown): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2010") return false;
  const cause = (e.meta as { driverAdapterError?: { cause?: { kind?: string; originalCode?: string } } } | undefined)
    ?.driverAdapterError?.cause;
  return cause?.kind === "TableDoesNotExist" || cause?.originalCode === "42P01";
}

/**
 * Exporte `auth.users` et `auth.identities` par SQL brut (Prisma ne modélise pas le schéma
 * `auth` de Supabase). Ce sont les comptes de connexion : sans eux, une restauration rend les
 * données mais personne ne peut se connecter. Résilience identique à `collecterTables` : schéma
 * `auth` absent → ignoré et consigné, jamais fatal.
 */
export async function collecterAuth(
  prisma: PrismaClient
): Promise<{ auth: AuthDump; tablesIgnorees: TableIgnoree[] }> {
  const tablesIgnorees: TableIgnoree[] = [];
  const auth: AuthDump = { users: [], identities: [] };

  try {
    auth.users = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT ${COLONNES_AUTH_USERS.map((c) => `"${c}"`).join(", ")} FROM auth.users`
    );
    console.log(`  auth.users: ${auth.users.length}`);
  } catch (e) {
    if (!estSchemaAuthAbsent(e)) throw e; // erreur globale (connexion, auth...) — fatale
    tablesIgnorees.push({
      table: "auth.users",
      code: "42P01",
      raison: "schéma auth absent de la base cible (PostgreSQL hors Supabase, ex. base de test)",
    });
    console.warn(`  auth.users: IGNORÉE — schéma auth absent`);
  }

  try {
    auth.identities = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT ${COLONNES_AUTH_IDENTITIES.map((c) => `"${c}"`).join(", ")} FROM auth.identities`
    );
    console.log(`  auth.identities: ${auth.identities.length}`);
  } catch (e) {
    if (!estSchemaAuthAbsent(e)) throw e;
    tablesIgnorees.push({
      table: "auth.identities",
      code: "42P01",
      raison: "schéma auth absent de la base cible (PostgreSQL hors Supabase, ex. base de test)",
    });
    console.warn(`  auth.identities: IGNORÉE — schéma auth absent`);
  }

  return { auth, tablesIgnorees };
}

export type SauvegardePrecedente = { fichier: string; date: Date; totalRows: number };

/** Repère la dernière sauvegarde RÉUSSIE dans `dir` (fichiers `rh-pef_*.json`). Un fichier
 *  illisible/corrompu est ignoré (pas fatal) plutôt que de casser la détection. */
export function trouverDerniereSauvegarde(dir: string): SauvegardePrecedente | null {
  let noms: string[];
  try {
    noms = readdirSync(dir).filter((n) => n.startsWith("rh-pef_") && n.endsWith(".json"));
  } catch {
    return null;
  }
  let meilleure: SauvegardePrecedente | null = null;
  for (const nom of noms) {
    try {
      const chemin = join(dir, nom);
      const { mtime } = statSync(chemin);
      if (meilleure && mtime <= meilleure.date) continue;
      const contenu = JSON.parse(readFileSync(chemin, "utf-8"));
      const totalRows =
        typeof contenu?.meta?.totalRows === "number"
          ? contenu.meta.totalRows
          : Object.values(contenu?.models ?? {}).reduce(
              (s: number, rows) => s + (Array.isArray(rows) ? rows.length : 0),
              0
            );
      meilleure = { fichier: nom, date: mtime, totalRows };
    } catch {
      continue;
    }
  }
  return meilleure;
}

const QUARANTE_HUIT_HEURES_MS = 48 * 60 * 60 * 1000;

/** Le vrai problème n'est pas la panne isolée, c'est qu'elle passe inaperçue : avertissement si
 *  aucune sauvegarde réussie de moins de 48 h n'existe. */
export function avertissementAgeSauvegarde(derniere: SauvegardePrecedente | null, maintenant: Date): string | null {
  if (!derniere) return "AUCUNE sauvegarde précédente trouvée — filet de sécurité absent.";
  const ageMs = maintenant.getTime() - derniere.date.getTime();
  if (ageMs > QUARANTE_HUIT_HEURES_MS) {
    const heures = Math.floor(ageMs / (60 * 60 * 1000));
    return `Dernière sauvegarde réussie il y a ${heures} h (${derniere.fichier}) — plus de 48 h sans filet de sécurité.`;
  }
  return null;
}

const TAILLE_MIN_OCTETS = 2048; // un JSON en dessous de 2 Ko est structurellement vide
const RATIO_CHUTE_ALERTE = 0.5; // moins de la moitié de la sauvegarde précédente = suspect

/** Une sauvegarde qui « réussit » mais ne vaut rien (fichier minuscule, ou chute brutale du
 *  nombre de lignes par rapport à la précédente) est aussi dangereuse qu'une panne silencieuse. */
export function avertissementVolumeSauvegarde(
  totalRowsActuel: number,
  tailleOctets: number,
  precedente: SauvegardePrecedente | null
): string | null {
  if (tailleOctets < TAILLE_MIN_OCTETS) {
    return `Fichier anormalement petit (${tailleOctets} octets, ${totalRowsActuel} ligne(s)) — probablement inexploitable.`;
  }
  if (precedente && precedente.totalRows > 0 && totalRowsActuel < precedente.totalRows * RATIO_CHUTE_ALERTE) {
    return `Chute brutale du volume : ${totalRowsActuel} ligne(s) contre ${precedente.totalRows} lors de la sauvegarde précédente (${precedente.fichier}).`;
  }
  return null;
}

export type ResultatSauvegarde = {
  file: string;
  totalRows: number;
  tablesIgnorees: TableIgnoree[];
  size: number;
  avertissementAge: string | null;
  avertissementVolume: string | null;
};

/** Orchestre une sauvegarde complète : avertissement d'âge, collecte résiliente, écriture du
 *  fichier (avec la liste des tables ignorées EN métadonnées, pour qui restaure dans six mois),
 *  avertissement de volume. `models` est injectable pour les tests (jamais Prisma.dmmf implicite
 *  côté logique testable). */
export async function executerSauvegarde(
  prisma: PrismaClient,
  dir: string,
  maintenant: Date = new Date(),
  models: string[] = Prisma.dmmf.datamodel.models.map((m) => m.name)
): Promise<ResultatSauvegarde> {
  mkdirSync(dir, { recursive: true });

  const derniere = trouverDerniereSauvegarde(dir);
  const avertissementAge = avertissementAgeSauvegarde(derniere, maintenant);
  if (avertissementAge) console.warn(`\n/!\\ ${avertissementAge}\n`);

  const { out, tablesIgnorees: tablesIgnoreesModeles, totalRows: totalRowsModeles } = await collecterTables(
    prisma,
    models
  );
  const { auth, tablesIgnorees: tablesIgnoreesAuth } = await collecterAuth(prisma);
  const tablesIgnorees = [...tablesIgnoreesModeles, ...tablesIgnoreesAuth];
  const totalRows = totalRowsModeles + auth.users.length + auth.identities.length;

  const stamp = maintenant.toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const file = join(dir, `rh-pef_${stamp}.json`);
  const payload = {
    exportedAt: maintenant.toISOString(),
    meta: { totalRows, tablesIgnorees },
    models: out,
    // Clé DISTINCTE des modèles Prisma : ce sont les comptes de connexion (auth.users/identities
    // du schéma Supabase), jamais mélangés aux données métier — cf. l'avertissement en tête de
    // fichier, ce sont désormais des secrets de première catégorie (mots de passe chiffrés).
    auth,
  };
  writeFileSync(file, JSON.stringify(payload, replacer, 0));
  const { size } = statSync(file);

  console.log(
    `\n✓ ${models.length - tablesIgnoreesModeles.length}/${models.length} tables, ${totalRows} lignes (dont ${auth.users.length} compte(s) de connexion) → ${file} (${(size / 1024 / 1024).toFixed(1)} Mo)`
  );
  console.warn(
    `\n/!\\ Ce fichier contient désormais des mots de passe CHIFFRÉS (auth.users) en plus de la paie — ne jamais le déposer sur un cloud public ni le transmettre.`
  );
  if (tablesIgnorees.length > 0) {
    console.warn(
      `\n/!\\ ${tablesIgnorees.length} table(s) IGNORÉE(S) — absente(s) de la base cible : ${tablesIgnorees
        .map((t) => t.table)
        .join(", ")}`
    );
  }
  const avertissementVolume = avertissementVolumeSauvegarde(totalRows, size, derniere);
  if (avertissementVolume) console.warn(`\n/!\\ ${avertissementVolume}`);

  return { file, totalRows, tablesIgnorees, size, avertissementAge, avertissementVolume };
}

// Exécution directe uniquement (jamais lors d'un import par les tests).
if (process.argv[1] && process.argv[1].endsWith("backup-json.ts")) {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL }),
  });
  const dir = join(homedir(), "Sauvegardes-RH-PEF");
  executerSauvegarde(prisma, dir)
    .catch((e) => {
      console.error("ERR", e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}

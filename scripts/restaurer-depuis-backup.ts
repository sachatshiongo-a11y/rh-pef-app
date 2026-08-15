/**
 * Restaure une base VIDE (schéma déjà à jour, `npx prisma migrate deploy`) à partir d'une
 * sauvegarde JSON produite par `scripts/backup-json.ts`. Permet de recréer toutes les données
 * (y compris les comptes de connexion) dans un nouveau projet Supabase — utile si l'ancien projet
 * a dû être supprimé avant d'en créer un nouveau.
 *
 * ⚠️ Ce script ÉCRIT (INSERT) dans la base visée par `NOUVEAU_DIRECT_URL`. Il ne doit JAMAIS
 * viser la production : `NOUVEAU_DIRECT_URL` est une variable D'ENVIRONNEMENT SÉPARÉE de
 * `DATABASE_URL`/`DIRECT_URL` (celles du `.env` du dépôt, qui pointent la production) et le
 * script refuse de tourner si elle leur est identique (cf. `verifierPasProduction`).
 *
 * Format attendu (celui écrit par `backup-json.ts` depuis le 2026-08) :
 *   { exportedAt, meta: { totalRows, tablesIgnorees }, models: { User: [...], ... },
 *     auth: { users: [...], identities: [...] } }
 * L'ANCIEN format (plat : `{ "User": [...], "auth.users": [...] }`) n'est PLUS reconnu et fait
 * REFUSER la restauration — mieux vaut un refus net qu'une restauration de zéro ligne en silence
 * (c'est précisément le défaut corrigé ici : avant, `dump["User"]` valait `undefined` sur un
 * fichier au nouveau format, et `?? []` transformait ça en restauration silencieuse de rien).
 *
 * Usage :
 *   NOUVEAU_DIRECT_URL="postgresql://..." \
 *     npx tsx scripts/restaurer-depuis-backup.ts backups/rh-pef_2026-08-15-21-00.json
 */
import "dotenv/config";
import { Client } from "pg";
import fs from "node:fs";
import { Prisma } from "@prisma/client";

/**
 * ─── Ordre d'insertion : DÉDUIT DU SCHÉMA, jamais recopié à la main ─────────────────────────
 *
 * L'ancienne constante `ORDRE` était une liste écrite à la main de 22 modèles « RH/paie »
 * historiques. Le schéma en compte aujourd'hui 77 (Stock & Achats, Exploitation, Fiches
 * techniques, plannings...) : cette liste avait pris du retard et le prendrait à nouveau au
 * prochain module. Elle est remplacée par un calcul À L'EXÉCUTION :
 *
 *  1. La liste des MODÈLES vient de `Prisma.dmmf.datamodel.models` — c'est directement ce que
 *     `npx prisma generate` produit à partir de `schema.prisma` : un nouveau modèle y apparaît
 *     tout seul, sans toucher ce fichier (cf. le test qui verrouille cette propriété).
 *
 *  2. Le GRAPHE DE DÉPENDANCES (qui référence qui) vient d'une introspection SQL de la base
 *     CIBLE elle-même (`information_schema` : contraintes FOREIGN KEY + nullabilité de la
 *     colonne). PAS de `Prisma.dmmf.datamodel` pour ça : en Prisma 7, le DMMF exposé au runtime
 *     du client est volontairement allégé — les champs de relation n'y portent plus
 *     `relationFromFields`/`relationToFields`/`isRequired`/`isList` (vérifié : seuls
 *     `name`/`kind`/`type`/`relationName` survivent). L'ancienne API DMMF complète (celle que la
 *     mémoire d'un modèle de langage suppose) n'existe plus côté client — cf. AGENTS.md : « cette
 *     version de Next [et de Prisma] n'est pas celle de ta mémoire ». La base CIBLE, elle, vient
 *     d'être migrée avec `npx prisma migrate deploy` (précondition documentée en tête de fichier)
 *     : ses contraintes FK sont donc l'image exacte et à jour du schéma, sans dépendre du format
 *     du DMMF ni d'un parsing texte fragile de `schema.prisma`.
 *
 *  3. Un tri topologique (Kahn) sur ce graphe donne l'ordre d'insertion table par table.
 *
 * Auto-références et cycles : cf. `calculerPlanInsertion` ci-dessous, qui documente et teste
 * (unitairement, sans base) les deux stratégies retenues.
 */

export type FkEdge = { table: string; column: string; refTable: string; nullable: boolean };

/**
 * Introspection SQL : une ligne par colonne de clé étrangère ENTRE DEUX MODÈLES Prisma (filtre
 * `table_name = ANY(modeles) AND ... table_name = ANY(modeles)` des deux côtés — une FK vers une
 * table hors périmètre, ex. `auth.users`, n'apparaît pas ici, elle est gérée séparément). Aucun
 * nom de schéma Postgres n'est codé en dur (`public`/`stock`/`exploitation`...) : le filtre porte
 * sur les noms de TABLE, qui sont uniques dans tout `schema.prisma` (aucun modèle n'utilise
 * `@@map`, vérifié) — un futur module dans un nouveau schéma Postgres est couvert sans y toucher.
 */
export async function obtenirGrapheFk(dst: Client, modeles: string[]): Promise<FkEdge[]> {
  const { rows } = await dst.query(
    `SELECT tc.table_name AS "table", kcu.column_name AS "column", ccu.table_name AS "refTable",
            (col.is_nullable = 'YES') AS "nullable"
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
     JOIN information_schema.constraint_column_usage ccu
       ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
     JOIN information_schema.columns col
       ON col.table_schema = tc.table_schema AND col.table_name = tc.table_name AND col.column_name = kcu.column_name
     WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = ANY($1) AND ccu.table_name = ANY($1)`,
    [modeles]
  );
  return rows as FkEdge[];
}

type Dependance = { prealable: string; dependant: string };

/** Kahn : renvoie un ordre où chaque `prealable` précède son/ses `dependant`(s), ou `null` (avec
 *  les nœuds restants) si un cycle empêche de finir le tri. */
function tenterTriTopologique(
  noeuds: string[],
  deps: Dependance[]
): { ordre: string[] } | { ordre: null; resteEnCycle: string[] } {
  const suivants = new Map<string, Set<string>>(noeuds.map((n) => [n, new Set<string>()]));
  const indegree = new Map<string, number>(noeuds.map((n) => [n, 0]));
  for (const { prealable, dependant } of deps) {
    if (!suivants.has(prealable) || !suivants.has(dependant)) continue; // hors périmètre, ignoré
    if (!suivants.get(prealable)!.has(dependant)) {
      suivants.get(prealable)!.add(dependant);
      indegree.set(dependant, (indegree.get(dependant) ?? 0) + 1);
    }
  }
  // Tri du nom pour un ordre déterministe (reproductible d'une exécution à l'autre).
  const file = noeuds.filter((n) => indegree.get(n) === 0).sort();
  const ordre: string[] = [];
  while (file.length > 0) {
    const n = file.shift()!;
    ordre.push(n);
    const suite = [...(suivants.get(n) ?? [])].sort();
    for (const m of suite) {
      indegree.set(m, indegree.get(m)! - 1);
      if (indegree.get(m) === 0) file.push(m);
    }
  }
  if (ordre.length === noeuds.length) return { ordre };
  return { ordre: null, resteEnCycle: noeuds.filter((n) => !ordre.includes(n)) };
}

export type PlanInsertion = {
  /** Ordre d'insertion table par table (parents avant enfants). */
  ordre: string[];
  /** table -> colonne(s) qui pointent vers CETTE MÊME table (auto-référence). Stratégie : les
   *  LIGNES de cette table sont réordonnées (racines d'abord) avant insertion — cf.
   *  `trierLignesAutoReferentes`. Ne bloque jamais l'ordre TABLE : une auto-référence ne crée pas
   *  de cycle ENTRE tables, seulement un ordre requis ENTRE LIGNES d'une même table. */
  autoReferences: Record<string, string[]>;
  /** table -> colonne(s) nullable dont l'insertion est différée pour casser un CYCLE RÉEL entre
   *  au moins deux tables (rarissime, jamais rencontré dans ce schéma au moment d'écrire ce code —
   *  cf. le test qui le constate — mais géré explicitement, pas contourné en silence). Stratégie :
   *  la colonne est insérée à NULL, puis reportée à sa vraie valeur dans une 2e passe, une fois
   *  TOUTES les tables peuplées. */
  colonnesDifferees: Record<string, string[]>;
};

/**
 * Calcule l'ordre d'insertion à partir de la liste des modèles et du graphe de clés étrangères.
 * PURE (pas de base de données) — testable unitairement avec des modèles/arêtes fabriqués, y
 * compris pour prouver les cas qui n'existent pas (encore) dans le vrai schéma : auto-référence,
 * cycle cassable via une colonne nullable, cycle irréductible (uniquement des FK obligatoires).
 *
 * Stratégie pour les auto-références (une table qui pointe vers elle-même, ex. un `parentId`) :
 * elles sont retirées du graphe AVANT le tri (une boucle sur soi-même bloquerait Kahn pour rien,
 * une table n'a pas besoin d'être insérée « avant elle-même ») et rangées dans `autoReferences` —
 * c'est `executerRestauration` qui, à l'aide de ça, réordonne les LIGNES (racines d'abord) plutôt
 * que de différer la colonne : ça marche que la colonne soit nullable ou non, contrairement au
 * différé, et n'a pas besoin d'une 2e passe.
 *
 * Stratégie pour un cycle RÉEL entre ≥ 2 tables : on tente d'abord le tri avec TOUTES les arêtes
 * (obligatoires + nullable). S'il échoue, on retire une à une des arêtes NULLABLE prises dans le
 * sous-graphe encore en cycle (jamais une arête obligatoire) jusqu'à ce que le tri réussisse ; les
 * colonnes retirées sont rangées dans `colonnesDifferees`. Si aucune arête nullable ne permet de
 * sortir du cycle (donc un cycle formé uniquement de FK obligatoires), la fonction REFUSE : un tel
 * cycle ne peut être résolu qu'à la main, jamais contourné en silence.
 */
export function calculerPlanInsertion(modeles: string[], edgesBrutes: FkEdge[]): PlanInsertion {
  const autoReferences: Record<string, string[]> = {};
  const edges = edgesBrutes.filter((e) => {
    if (e.table === e.refTable) {
      (autoReferences[e.table] ??= []).push(e.column);
      return false;
    }
    return true;
  });

  const versDependance = (e: FkEdge): Dependance & { table: string; column: string } => ({
    prealable: e.refTable,
    dependant: e.table,
    table: e.table,
    column: e.column,
  });
  const requises = edges.filter((e) => !e.nullable).map(versDependance);
  let nullables = edges.filter((e) => e.nullable).map(versDependance);

  // Un cycle formé UNIQUEMENT de FK obligatoires est irréductible — jamais contourné en silence.
  const essaiRequisSeuls = tenterTriTopologique(modeles, requises);
  if (essaiRequisSeuls.ordre === null) {
    throw new Error(
      `Cycle réel entre tables détecté DANS LES CLÉS ÉTRANGÈRES OBLIGATOIRES (donc irréductible ` +
        `sans intervention manuelle) : ${essaiRequisSeuls.resteEnCycle.join(", ")}. ` +
        `Ce n'est PAS contourné automatiquement — corriger le schéma ou traiter ce cas à la main.`
    );
  }

  const colonnesDifferees: Record<string, string[]> = {};
  let resultat = tenterTriTopologique(modeles, [...requises, ...nullables]);
  let gardeFou = nullables.length + 1; // borne stricte : au pire, une arête nullable retirée par tour
  while (resultat.ordre === null) {
    if (gardeFou-- <= 0) {
      throw new Error("Boucle de résolution de cycle non convergente — anomalie interne à corriger.");
    }
    const cycle = new Set(resultat.resteEnCycle);
    const idx = nullables.findIndex((d) => cycle.has(d.prealable) && cycle.has(d.dependant));
    if (idx === -1) {
      throw new Error(
        `Cycle réel entre tables détecté (${[...cycle].join(", ")}) qu'aucune colonne nullable ` +
          `ne permet de résoudre — ce n'est PAS contourné automatiquement.`
      );
    }
    const [retiree] = nullables.splice(idx, 1);
    (colonnesDifferees[retiree.table] ??= []).push(retiree.column);
    console.warn(
      `\n/!\\ Cycle réel entre tables (${[...cycle].join(", ")}) — colonne "${retiree.table}.${retiree.column}" ` +
        `DIFFÉRÉE (insérée à NULL puis reportée en 2e passe) pour le résoudre.`
    );
    resultat = tenterTriTopologique(modeles, [...requises, ...nullables]);
  }

  return { ordre: resultat.ordre, autoReferences, colonnesDifferees };
}

/**
 * Réordonne les lignes d'UNE table qui s'auto-référence (ex. `sousFicheId`) : les racines (dont la
 * colonne auto-référente vaut `null`, ou pointe vers une ligne absente du lot — ex. sous-recette
 * déjà en base) d'abord, puis chaque ligne après celle(s) qu'elle référence — insertion ligne par
 * ligne dans cet ordre, jamais de colonne mise à NULL puis reportée (contrairement au cas des
 * cycles ENTRE tables) : ça fonctionne aussi pour une colonne auto-référente NOT NULL.
 * Lève une erreur explicite sur un cycle dans les DONNÉES elles-mêmes (jamais vu, mais une
 * sauvegarde corrompue ne doit pas boucler en silence).
 */
export function trierLignesAutoReferentes(
  rows: Record<string, unknown>[],
  colonnesAutoReferentes: string[]
): Record<string, unknown>[] {
  if (rows.length === 0 || colonnesAutoReferentes.length === 0) return rows;
  const parId = new Map(rows.map((r) => [String(r.id), r]));
  const visitees = new Set<string>();
  const enCours = new Set<string>();
  const resultat: Record<string, unknown>[] = [];

  function visiter(r: Record<string, unknown>) {
    const id = String(r.id);
    if (visitees.has(id)) return;
    if (enCours.has(id)) {
      throw new Error(
        `Cycle auto-référent dans les DONNÉES (pas dans le schéma) autour de la ligne id=${id} — ` +
          `restauration impossible sans correction manuelle du fichier de sauvegarde.`
      );
    }
    enCours.add(id);
    for (const col of colonnesAutoReferentes) {
      const ref = r[col];
      if (ref != null && parId.has(String(ref))) visiter(parId.get(String(ref))!);
    }
    enCours.delete(id);
    visitees.add(id);
    resultat.push(r);
  }
  for (const r of rows) visiter(r);
  return resultat;
}

/** Combine `Prisma.dmmf` (liste des modèles — jamais codée en dur) et l'introspection de la base
 *  CIBLE `dst` (graphe de FK réel) pour produire le plan d'insertion complet. C'est CE calcul, à
 *  l'exécution, qui remplace l'ancienne constante `ORDRE`. */
export async function construirePlanInsertion(dst: Client): Promise<PlanInsertion> {
  const modeles = Prisma.dmmf.datamodel.models.map((m) => m.name);
  const edges = await obtenirGrapheFk(dst, modeles);
  return calculerPlanInsertion(modeles, edges);
}

/** Table -> colonnes dont la séquence auto-incrémentée doit être réalignée après restauration
 *  (id entier généré par `nextval(...)`) — déduit de la base CIBLE, jamais d'une liste à la main :
 *  la même dérive que l'ancien `ORDRE` guettait ce genre de liste (`ExerciceFiscal`,
 *  `ParametreLegal`... écrits en dur alors que de nouveaux modèles à id entier peuvent apparaître). */
async function obtenirTablesAutoIncrement(dst: Client, modeles: string[]): Promise<string[]> {
  const { rows } = await dst.query(
    `SELECT table_name AS "table" FROM information_schema.columns
     WHERE column_name = 'id' AND column_default LIKE 'nextval(%' AND table_name = ANY($1)`,
    [modeles]
  );
  return rows.map((r: { table: string }) => r.table);
}

/**
 * `schema.prisma` déclare TROIS schémas Postgres (`public`, `stock`, `exploitation` — cf.
 * `datasource db { schemas = [...] }`) : une table de `stock`/`exploitation` n'est PAS résolue par
 * un simple `INSERT INTO "NomDeTable"` (le `search_path` par défaut d'une connexion `pg.Client`
 * ne contient que `public`). Plutôt que de coder ces noms de schéma en dur (même dérive que
 * l'ancien `ORDRE`), on demande à Postgres lui-même dans quel schéma vit chaque table, et TOUTES
 * les requêtes de ce fichier qualifient désormais leurs noms de table avec le résultat
 * (`"schéma"."Table"`). Une table trouvée dans ≥ 2 schémas est un cas ambigu qu'on refuse plutôt
 * que de deviner (n'arrive pas avec des modèles Prisma, dont le nom est unique dans tout le
 * fichier — mais un futur `@@map` vers un nom déjà pris ailleurs le déclencherait).
 */
export async function obtenirSchemasTables(dst: Client, modeles: string[]): Promise<Record<string, string>> {
  const { rows } = await dst.query(
    `SELECT table_name AS "table", table_schema AS "schema" FROM information_schema.tables WHERE table_name = ANY($1)`,
    [modeles]
  );
  const carte: Record<string, string> = {};
  for (const r of rows as { table: string; schema: string }[]) {
    if (carte[r.table] && carte[r.table] !== r.schema) {
      throw new Error(
        `Table "${r.table}" trouvée dans plusieurs schémas Postgres (${carte[r.table]} et ${r.schema}) — ` +
          `ambiguïté refusée plutôt que devinée.`
      );
    }
    carte[r.table] = r.schema;
  }
  return carte;
}

/** Qualifie un nom de table avec son schéma Postgres réel (`obtenirSchemasTables`) — nom brut en
 *  repli si la table n'a pas été trouvée (ne devrait pas arriver pour un modèle du plan). */
function qualifier(schemas: Record<string, string>, table: string): string {
  const schema = schemas[table];
  return schema ? `"${schema}"."${table}"` : `"${table}"`;
}

export type DumpValide = {
  exportedAt?: string;
  meta?: { totalRows?: number; tablesIgnorees?: unknown[] };
  models: Record<string, Record<string, unknown>[]>;
  auth?: { users?: Record<string, unknown>[]; identities?: Record<string, unknown>[] };
};

/**
 * REFUSE la restauration si le fichier n'est pas au format actuel — jamais de restauration
 * silencieuse de zéro ligne. Deux cas rejetés explicitement : l'ANCIEN format plat (clés de
 * modèles au premier niveau, ex. `User`/`auth.users`) et un fichier au bon format mais VIDE
 * (`models` absent ou sans aucune table).
 */
export function validerFormatDump(dump: unknown): asserts dump is DumpValide {
  if (!dump || typeof dump !== "object" || Array.isArray(dump)) {
    throw new Error("Format de sauvegarde non reconnu : le fichier n'est pas un objet JSON.");
  }
  const d = dump as Record<string, unknown>;
  const indicesAncienFormat = ["User", "Config", "Employee", "auth.users"].filter((k) => k in d);
  if (!("models" in d) || indicesAncienFormat.length > 0) {
    throw new Error(
      `Format de sauvegarde non reconnu — restauration REFUSÉE (jamais une restauration silencieuse de zéro ligne). ` +
        `Ce fichier ressemble à l'ANCIEN format plat (clés au premier niveau : ${
          indicesAncienFormat.join(", ") || "clé `models` absente"
        }) ; le format attendu range les modèles sous une clé \`models\` et les comptes sous \`auth\`. ` +
        `Ce script ne sait PAS convertir l'ancien format — il faut soit régénérer la sauvegarde avec la version actuelle de backup-json.ts, soit adapter ce fichier à la main.`
    );
  }
  if (typeof d.models !== "object" || d.models === null || Array.isArray(d.models)) {
    throw new Error("Format de sauvegarde non reconnu : `models` n'est pas un objet de tables.");
  }
  if (Object.keys(d.models as object).length === 0) {
    throw new Error(
      "Sauvegarde REFUSÉE : `models` ne contient AUCUNE table. Un fichier de sauvegarde vide n'est jamais restauré silencieusement."
    );
  }
}

export type CompteTable = { lues: number; inserees: number };

/**
 * `tableSql` est le nom de table DÉJÀ QUALIFIÉ (`qualifier()` — `"schéma"."Table"`), jamais un nom
 * brut : `stock`/`exploitation` ne sont pas dans le `search_path` par défaut d'une connexion.
 * `colonnesADifferer` (nullable par construction, cf. `calculerPlanInsertion`) sont insérées à
 * NULL ici — jamais leur vraie valeur — pour casser un cycle réel entre tables ; c'est
 * `appliquerColonnesDifferees` qui les reporte, une fois TOUTES les tables peuplées.
 */
async function insererLignes(
  dst: Client,
  tableSql: string,
  rows: Record<string, unknown>[],
  colonnesADifferer: string[] = []
): Promise<CompteTable> {
  if (!rows || rows.length === 0) return { lues: 0, inserees: 0 };
  const colonnes = Object.keys(rows[0]);
  const listeCols = colonnes.map((c) => `"${c}"`).join(", ");
  let inserees = 0;
  for (const row of rows) {
    const valeurs = colonnes.map((c) => (colonnesADifferer.includes(c) ? null : row[c]));
    const placeholders = colonnes.map((_, i) => `$${i + 1}`).join(", ");
    const res = await dst.query(
      `INSERT INTO ${tableSql} (${listeCols}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
      valeurs
    );
    inserees += res.rowCount ?? 0;
  }
  return { lues: rows.length, inserees };
}

/** 2e passe des colonnes différées (cycle réel entre tables cassé via une colonne nullable) : à ce
 *  stade, toutes les tables ont été peuplées, la ligne référencée existe forcément désormais. Les
 *  valeurs `null` d'origine ne sont pas touchées (déjà correctes après `insererLignes`).
 *  `tableSql` : cf. `insererLignes`, déjà qualifié. */
async function appliquerColonnesDifferees(
  dst: Client,
  tableSql: string,
  rows: Record<string, unknown>[],
  colonnes: string[]
): Promise<number> {
  let majees = 0;
  for (const row of rows) {
    for (const col of colonnes) {
      const valeur = row[col];
      if (valeur === null || valeur === undefined) continue;
      const res = await dst.query(`UPDATE ${tableSql} SET "${col}" = $1 WHERE id = $2`, [valeur, row.id]);
      majees += res.rowCount ?? 0;
    }
  }
  return majees;
}

async function restaurerAuthUsers(dst: Client, users: Record<string, unknown>[]): Promise<CompteTable> {
  let inserees = 0;
  for (const u of users) {
    const res = await dst.query(
      `INSERT INTO auth.users
        (instance_id, id, email, encrypted_password, email_confirmed_at, created_at, updated_at,
         raw_app_meta_data, raw_user_meta_data, aud, role)
       VALUES ('00000000-0000-0000-0000-000000000000', $1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (id) DO NOTHING`,
      [
        u.id, u.email, u.encrypted_password, u.email_confirmed_at, u.created_at, u.updated_at,
        u.raw_app_meta_data, u.raw_user_meta_data, u.aud ?? "authenticated", u.role ?? "authenticated",
      ]
    );
    inserees += res.rowCount ?? 0;
  }

  // GoTrue lit ces colonnes de jetons comme du texte : elles doivent être '' et non NULL,
  // sinon toute requête auth échoue en 500 "Database error finding users".
  if (users.length > 0) {
    await dst.query(`UPDATE auth.users SET
        confirmation_token = COALESCE(confirmation_token, ''),
        recovery_token = COALESCE(recovery_token, ''),
        email_change_token_new = COALESCE(email_change_token_new, ''),
        email_change = COALESCE(email_change, ''),
        email_change_token_current = COALESCE(email_change_token_current, ''),
        phone_change = COALESCE(phone_change, ''),
        phone_change_token = COALESCE(phone_change_token, ''),
        reauthentication_token = COALESCE(reauthentication_token, '')`);
  }
  return { lues: users.length, inserees };
}

/**
 * Supabase exige une ligne `auth.identities` (provider 'email') EN PLUS de `auth.users` pour
 * autoriser la connexion par mot de passe. Depuis l'ajout du schéma `auth` à la sauvegarde, les
 * identités RÉELLEMENT exportées sont réinjectées telles quelles (préserve provider/horodatage
 * d'origine, couvre aussi d'éventuels providers autres que 'email'). En repli — sauvegarde d'un
 * ancien format qui n'exportait pas encore `auth.identities`, ou compte sans identité exportée —
 * une identité 'email' minimale est fabriquée, comme avant.
 */
async function restaurerAuthIdentities(
  dst: Client,
  users: Record<string, unknown>[],
  identitesExportees: Record<string, unknown>[]
): Promise<CompteTable> {
  const parUtilisateur = new Map<string, Record<string, unknown>[]>();
  for (const idt of identitesExportees) {
    const uid = String(idt.user_id);
    const liste = parUtilisateur.get(uid) ?? [];
    liste.push(idt);
    parUtilisateur.set(uid, liste);
  }

  let inserees = 0;
  for (const u of users) {
    const exportees = parUtilisateur.get(String(u.id));
    if (exportees && exportees.length > 0) {
      for (const idt of exportees) {
        const res = await dst.query(
          `INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
           SELECT $1, $2, $3::jsonb, $4, $5, $6, $7
           WHERE NOT EXISTS (SELECT 1 FROM auth.identities WHERE user_id = $2 AND provider = $4)`,
          [
            idt.provider_id, u.id, JSON.stringify(idt.identity_data ?? {}), idt.provider,
            idt.last_sign_in_at ?? null, idt.created_at ?? null, idt.updated_at ?? null,
          ]
        );
        inserees += res.rowCount ?? 0;
      }
    } else {
      const res = await dst.query(
        `INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
         SELECT $1, $2, $3::jsonb, 'email', now(), now(), now()
         WHERE NOT EXISTS (SELECT 1 FROM auth.identities WHERE user_id = $2 AND provider = 'email')`,
        [u.id, u.id, JSON.stringify({ sub: u.id, email: u.email, email_verified: true, phone_verified: false })]
      );
      inserees += res.rowCount ?? 0;
    }
  }
  return { lues: identitesExportees.length, inserees };
}

export type ResultatRestauration = {
  authUsers: CompteTable;
  authIdentities: CompteTable;
  tables: Record<string, CompteTable>;
  tablesNonPlacees: string[];
  tablesAbsentesDuFichier: string[];
  /** Le plan d'insertion CALCULÉ pour cette exécution (ordre, auto-références, colonnes
   *  différées) — exposé pour que les tests puissent vérifier, sans liste codée en dur, qu'AUCUN
   *  modèle du schéma n'est resté hors de `plan.ordre`. */
  plan: PlanInsertion;
};

/**
 * Exécute la restauration sur une connexion `dst` DÉJÀ OUVERTE (le caller gère connexion/fin, ce
 * qui rend la fonction testable sur un Postgres éphémère sans dupliquer la logique CLI).
 * `dump` doit avoir déjà passé `validerFormatDump`.
 */
export async function executerRestauration(dst: Client, dump: DumpValide): Promise<ResultatRestauration> {
  const authUsersSource = dump.auth?.users ?? [];
  const authIdentitiesSource = dump.auth?.identities ?? [];

  const authUsers = await restaurerAuthUsers(dst, authUsersSource);
  console.log(`  auth.users: ${authUsers.lues} lue(s) / ${authUsers.inserees} insérée(s)`);
  const authIdentities = await restaurerAuthIdentities(dst, authUsersSource, authIdentitiesSource);
  console.log(`  auth.identities: ${authIdentities.lues} lue(s) / ${authIdentities.inserees} insérée(s)`);

  // Plan CALCULÉ (pas une liste écrite à la main) : ordre topologique déduit du DMMF Prisma
  // (liste des modèles) + de l'introspection FK de la base cible (cf. `construirePlanInsertion`).
  const plan = await construirePlanInsertion(dst);
  // schema.prisma vit dans 3 schémas Postgres (public/stock/exploitation) : chaque requête doit
  // qualifier son nom de table (cf. `qualifier`), le search_path par défaut ne suffit pas.
  const schemas = await obtenirSchemasTables(dst, plan.ordre);

  const tables: Record<string, CompteTable> = {};
  for (const table of plan.ordre) {
    const colonnesAutoRef = plan.autoReferences[table];
    let rows = dump.models[table] ?? [];
    if (colonnesAutoRef && colonnesAutoRef.length > 0) {
      rows = trierLignesAutoReferentes(rows, colonnesAutoRef);
    }
    const compte = await insererLignes(dst, qualifier(schemas, table), rows, plan.colonnesDifferees[table] ?? []);
    tables[table] = compte;
    console.log(`  ${table}: ${compte.lues} lue(s) / ${compte.inserees} insérée(s)`);
  }

  // 2e passe : reporte les colonnes différées (cycle réel entre tables, cf. `calculerPlanInsertion`)
  // maintenant que TOUTES les tables sont peuplées et que la ligne référencée existe forcément.
  for (const [table, colonnes] of Object.entries(plan.colonnesDifferees)) {
    if (colonnes.length === 0) continue;
    const majees = await appliquerColonnesDifferees(dst, qualifier(schemas, table), dump.models[table] ?? [], colonnes);
    console.log(`  ${table}: ${majees} colonne(s) différée(s) reportée(s) en 2e passe (${colonnes.join(", ")})`);
  }

  // Tables présentes dans le fichier mais que ce script ne sait pas placer (absentes du plan — la
  // sauvegarde est plus ANCIENNE que le schéma actuel) — AVANT, elles étaient silencieusement
  // ignorées : on les nomme explicitement.
  const tablesNonPlacees = Object.keys(dump.models).filter((t) => !plan.ordre.includes(t));
  // Tables attendues (plan.ordre) totalement absentes du fichier — distinct d'une table présente à
  // 0 ligne : ça peut signaler un modèle oublié dans backup-json.ts (déjà arrivé une fois).
  const tablesAbsentesDuFichier = plan.ordre.filter((t) => !(t in dump.models));

  if (tablesNonPlacees.length > 0) {
    console.warn(
      `\n/!\\ ${tablesNonPlacees.length} table(s) du fichier NON PLACÉE(S) (absentes du schéma actuel, donc PAS restaurées) : ${tablesNonPlacees.join(", ")}`
    );
  }
  if (tablesAbsentesDuFichier.length > 0) {
    console.warn(
      `\n/!\\ ${tablesAbsentesDuFichier.length} table(s) attendue(s) ABSENTE(S) du fichier (0 ligne, pas juste vide — vérifier que la sauvegarde n'a pas oublié un modèle) : ${tablesAbsentesDuFichier.join(", ")}`
    );
  }

  // Réaligne les séquences auto-incrémentées — déduites de la base cible, jamais d'une liste à la main.
  const tablesAutoIncrement = await obtenirTablesAutoIncrement(dst, plan.ordre);
  for (const t of tablesAutoIncrement) {
    const tSql = qualifier(schemas, t);
    await dst
      .query(`SELECT setval(pg_get_serial_sequence('${tSql}', 'id'), COALESCE((SELECT MAX(id) FROM ${tSql}), 1), true)`)
      .catch(() => {});
  }

  return { authUsers, authIdentities, tables, tablesNonPlacees, tablesAbsentesDuFichier, plan };
}

/**
 * Garde-fou : `NOUVEAU_DIRECT_URL` (la cible, sur laquelle on ÉCRIT) ne doit JAMAIS être
 * identique à `DATABASE_URL`/`DIRECT_URL` (celles du `.env` du dépôt, qui pointent la
 * PRODUCTION). Une simple faute de copier-coller de variable ne doit pas suffire à écraser la
 * production.
 */
export function verifierPasProduction(
  nouveauUrl: string,
  env: { DATABASE_URL?: string; DIRECT_URL?: string }
): void {
  const cibles = [env.DATABASE_URL, env.DIRECT_URL].filter((v): v is string => !!v && v.length > 0);
  if (cibles.includes(nouveauUrl)) {
    throw new Error(
      "REFUS : NOUVEAU_DIRECT_URL est identique à DATABASE_URL ou DIRECT_URL du .env (production). " +
        "Ce script ÉCRIT dans la base visée — il ne doit JAMAIS pointer la production."
    );
  }
}

// Exécution directe uniquement (jamais lors d'un import par les tests).
if (process.argv[1] && process.argv[1].endsWith("restaurer-depuis-backup.ts")) {
  const NOUVEAU = process.env.NOUVEAU_DIRECT_URL;
  const chemin = process.argv[2];

  if (!NOUVEAU || !chemin) {
    console.error(
      'Usage : NOUVEAU_DIRECT_URL="..." npx tsx scripts/restaurer-depuis-backup.ts <fichier-backup.json>'
    );
    process.exit(1);
  }

  (async () => {
    verifierPasProduction(NOUVEAU, { DATABASE_URL: process.env.DATABASE_URL, DIRECT_URL: process.env.DIRECT_URL });

    const dump: unknown = JSON.parse(fs.readFileSync(chemin, "utf-8"));
    validerFormatDump(dump);

    const dst = new Client({ connectionString: NOUVEAU });
    await dst.connect();
    try {
      const resultat = await executerRestauration(dst, dump);
      const totalInserees =
        resultat.authUsers.inserees +
        resultat.authIdentities.inserees +
        Object.values(resultat.tables).reduce((s, c) => s + c.inserees, 0);
      console.log(`\n✓ Restauration terminée — ${totalInserees} ligne(s) insérée(s) au total.`);
    } finally {
      await dst.end();
    }
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

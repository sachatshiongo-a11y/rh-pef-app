import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { creerBaseTest } from "@/lib/test/db";
import {
  executerSauvegarde,
  collecterTables,
  collecterAuth,
  trouverDerniereSauvegarde,
  avertissementAgeSauvegarde,
  avertissementVolumeSauvegarde,
} from "./backup-json";

/**
 * Reproduit EXACTEMENT le bug du 14 août sur un PostgreSQL ÉPHÉMÈRE (embedded-postgres, jeté à la
 * fin) — jamais une base réelle, jamais le `.env` du dépôt (qui pointe la PRODUCTION) : le schéma
 * local connaît un modèle (ici `JourFerie`, choisi pour ne dépendre d'aucune autre table) alors que
 * la table correspondante est absente de la base cible (`DROP TABLE`, simulant une migration pas
 * encore déployée). Avant le correctif, ceci arrêtait TOUTE la sauvegarde sans écrire de fichier.
 */

let prisma: PrismaClient;
let fermer: () => Promise<void>;

beforeAll(async () => {
  ({ prisma, fermer } = await creerBaseTest());
}, 240_000);

afterAll(async () => {
  await fermer?.();
});

function dirTemporaire() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pef-backup-test-"));
}

describe("collecterTables — une table absente (P2021) est ignorée, jamais fatale", () => {
  it("continue la collecte et nomme la table manquante, sans perdre les autres", async () => {
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "JourFerie" CASCADE`);
    await prisma.config
      .create({ data: { tauxChangeCDF: 2800, anneeCourante: 2026, moisCourant: 8 } })
      .catch(() => {});

    const models = Prisma.dmmf.datamodel.models.map((m) => m.name);
    expect(models).toContain("JourFerie"); // le modèle existe bien AU SCHÉMA (c'est le piège du 14 août)

    const { out, tablesIgnorees, totalRows } = await collecterTables(prisma, models);

    expect(tablesIgnorees).toHaveLength(1);
    expect(tablesIgnorees[0]).toMatchObject({ table: "JourFerie", code: "P2021" });
    // Les autres tables ont bien été collectées (pas d'arrêt net comme avant le correctif).
    expect(out).not.toHaveProperty("JourFerie");
    expect(Object.keys(out).length).toBeGreaterThan(50);
    expect(totalRows).toBeGreaterThanOrEqual(0);
  });
});

describe("executerSauvegarde — le fichier est écrit MALGRÉ la table manquante", () => {
  it("produit un JSON complet des autres tables, avec la lacune nommée en métadonnées", async () => {
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "JourFerie" CASCADE`);
    const dir = dirTemporaire();
    const models = Prisma.dmmf.datamodel.models.map((m) => m.name);

    const resultat = await executerSauvegarde(prisma, dir, new Date("2026-08-15T21:00:00.000Z"), models);

    expect(fs.existsSync(resultat.file)).toBe(true); // AVANT le correctif : aucun fichier
    // Sur ce Postgres éphémère (jamais de schéma `auth`), auth.users/auth.identities sont
    // ELLES AUSSI ignorées et nommées — même mécanisme de résilience que JourFerie.
    expect(resultat.tablesIgnorees.map((t) => t.table).sort()).toEqual(
      ["JourFerie", "auth.identities", "auth.users"].sort()
    );

    const contenu = JSON.parse(fs.readFileSync(resultat.file, "utf-8"));
    // La lacune est visible DANS le fichier lui-même, pas seulement dans le journal de la nuit.
    expect(contenu.meta.tablesIgnorees).toEqual(
      expect.arrayContaining([expect.objectContaining({ table: "JourFerie", code: "P2021" })])
    );
    expect(contenu.models).not.toHaveProperty("JourFerie");
    // D'autres tables, elles, sont bien présentes et complètes.
    expect(Object.keys(contenu.models).length).toBeGreaterThan(50);
    expect(contenu.models).toHaveProperty("Config");
    // Les comptes de connexion sont sous une clé DISTINCTE des modèles, jamais mélangés.
    expect(contenu).toHaveProperty("auth");
    expect(contenu.models).not.toHaveProperty("auth.users");
    expect(contenu.auth).toEqual({ users: [], identities: [] });
  });
});

describe("collecterAuth — le schéma `auth` (Supabase) est absent d'un PostgreSQL ordinaire", () => {
  it("ignore proprement auth.users/auth.identities sans lever d'erreur fatale", async () => {
    const { auth, tablesIgnorees } = await collecterAuth(prisma);
    expect(auth).toEqual({ users: [], identities: [] });
    expect(tablesIgnorees.map((t) => t.table).sort()).toEqual(["auth.identities", "auth.users"]);
    expect(tablesIgnorees.every((t) => t.code === "42P01")).toBe(true);
  });

  it("collecte réellement les comptes quand le schéma auth existe (minimal, façon Supabase)", async () => {
    await prisma.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS auth`);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS auth.users (
        id uuid PRIMARY KEY,
        email text,
        encrypted_password text,
        email_confirmed_at timestamptz,
        created_at timestamptz,
        updated_at timestamptz,
        raw_app_meta_data jsonb,
        raw_user_meta_data jsonb,
        aud text,
        role text
      )
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS auth.identities (
        id uuid PRIMARY KEY,
        provider_id text,
        user_id uuid,
        identity_data jsonb,
        provider text,
        last_sign_in_at timestamptz,
        created_at timestamptz,
        updated_at timestamptz
      )
    `);
    await prisma.$executeRawUnsafe(`
      INSERT INTO auth.users (id, email, encrypted_password, aud, role)
      VALUES ('11111111-1111-1111-1111-111111111111', 'test@example.com', '$2a$hash', 'authenticated', 'authenticated')
      ON CONFLICT DO NOTHING
    `);
    await prisma.$executeRawUnsafe(`
      INSERT INTO auth.identities (id, provider_id, user_id, identity_data, provider)
      VALUES ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111',
        '11111111-1111-1111-1111-111111111111', '{"sub":"11111111-1111-1111-1111-111111111111"}'::jsonb, 'email')
      ON CONFLICT DO NOTHING
    `);

    const { auth, tablesIgnorees } = await collecterAuth(prisma);
    expect(tablesIgnorees).toEqual([]);
    expect(auth.users).toHaveLength(1);
    expect(auth.users[0]).toMatchObject({ email: "test@example.com", encrypted_password: "$2a$hash" });
    expect(auth.identities).toHaveLength(1);
    expect(auth.identities[0]).toMatchObject({ provider: "email" });

    await prisma.$executeRawUnsafe(`DROP SCHEMA auth CASCADE`);
  });
});

describe("executerSauvegarde — une erreur globale reste fatale (jamais avalée)", () => {
  it("n'écrit AUCUN fichier si la connexion à la base cible échoue", async () => {
    const dir = dirTemporaire();
    const clientInjoignable = new PrismaClient({
      adapter: new PrismaPg({ connectionString: "postgresql://postgres:postgres@127.0.0.1:1/inexistante" }),
    });
    await expect(
      executerSauvegarde(clientInjoignable, dir, new Date(), ["Config"])
    ).rejects.toBeTruthy();
    expect(fs.readdirSync(dir).filter((n) => n.endsWith(".json"))).toHaveLength(0);
    await clientInjoignable.$disconnect();
  });
});

describe("trouverDerniereSauvegarde + avertissementAgeSauvegarde — l'absence de filet devient visible", () => {
  it("signale l'absence de toute sauvegarde précédente", () => {
    const dir = dirTemporaire();
    expect(trouverDerniereSauvegarde(dir)).toBeNull();
    expect(avertissementAgeSauvegarde(null, new Date())).toMatch(/AUCUNE/);
  });

  it("signale une dernière sauvegarde vieille de plus de 48 h", () => {
    const dir = dirTemporaire();
    const ancienne = path.join(dir, "rh-pef_2026-08-01-21-00.json");
    fs.writeFileSync(ancienne, JSON.stringify({ exportedAt: "2026-08-01T21:00:00.000Z", meta: { totalRows: 6750, tablesIgnorees: [] }, models: {} }));
    const vieilleDate = new Date("2026-08-01T21:00:00.000Z");
    fs.utimesSync(ancienne, vieilleDate, vieilleDate);

    const derniere = trouverDerniereSauvegarde(dir);
    expect(derniere?.totalRows).toBe(6750);

    const avert = avertissementAgeSauvegarde(derniere, new Date("2026-08-15T21:00:00.000Z"));
    expect(avert).toMatch(/48 h/);
  });

  it("ne signale rien si la dernière sauvegarde a moins de 48 h", () => {
    const dir = dirTemporaire();
    const recente = path.join(dir, "rh-pef_2026-08-14-21-00.json");
    fs.writeFileSync(recente, JSON.stringify({ exportedAt: "2026-08-14T21:00:00.000Z", meta: { totalRows: 6750, tablesIgnorees: [] }, models: {} }));
    const date = new Date("2026-08-14T21:00:00.000Z");
    fs.utimesSync(recente, date, date);

    const derniere = trouverDerniereSauvegarde(dir);
    expect(avertissementAgeSauvegarde(derniere, new Date("2026-08-15T11:00:00.000Z"))).toBeNull();
  });
});

describe("avertissementVolumeSauvegarde — une sauvegarde qui réussit mais ne vaut rien", () => {
  it("signale un fichier anormalement petit", () => {
    expect(avertissementVolumeSauvegarde(3, 500, null)).toMatch(/petit/);
  });

  it("signale une chute brutale du nombre de lignes par rapport à la précédente", () => {
    const precedente = { fichier: "rh-pef_2026-08-13-20-00.json", date: new Date("2026-08-13T20:00:00.000Z"), totalRows: 6750 };
    expect(avertissementVolumeSauvegarde(100, 500_000, precedente)).toMatch(/[Cc]hute/);
  });

  it("ne signale rien pour un volume stable ou en hausse", () => {
    const precedente = { fichier: "rh-pef_2026-08-13-20-00.json", date: new Date("2026-08-13T20:00:00.000Z"), totalRows: 6750 };
    expect(avertissementVolumeSauvegarde(8012, 3_034_107, precedente)).toBeNull();
  });
});

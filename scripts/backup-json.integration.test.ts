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
    expect(resultat.tablesIgnorees.map((t) => t.table)).toEqual(["JourFerie"]);

    const contenu = JSON.parse(fs.readFileSync(resultat.file, "utf-8"));
    // La lacune est visible DANS le fichier lui-même, pas seulement dans le journal de la nuit.
    expect(contenu.meta.tablesIgnorees).toEqual([
      expect.objectContaining({ table: "JourFerie", code: "P2021" }),
    ]);
    expect(contenu.models).not.toHaveProperty("JourFerie");
    // D'autres tables, elles, sont bien présentes et complètes.
    expect(Object.keys(contenu.models).length).toBeGreaterThan(50);
    expect(contenu.models).toHaveProperty("Config");
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

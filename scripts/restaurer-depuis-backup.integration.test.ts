import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";
import { executerSauvegarde } from "./backup-json";
import {
  validerFormatDump,
  verifierPasProduction,
  executerRestauration,
  ORDRE,
  type DumpValide,
} from "./restaurer-depuis-backup";

/**
 * PROUVE LE CYCLE COMPLET sur des PostgreSQL ÉPHÉMÈRES (embedded-postgres, jetés à la fin) :
 * source fabriquée → backup-json.ts → restaurer-depuis-backup.ts → comparaison. Jamais de vraies
 * données, jamais le `.env` du dépôt (production) — cf. `creerBaseTest()`.
 *
 * Le schéma `auth` (Supabase/GoTrue) n'existe pas nativement sur un Postgres nu : on le
 * RECONSTITUE À LA MAIN ici (colonnes exactement celles que `backup-json.ts` exporte et que
 * `restaurer-depuis-backup.ts` réinjecte), sur la source ET sur la cible, pour pouvoir rejouer le
 * cycle `auth.users`/`auth.identities` de bout en bout. C'est une approximation MINIMALE du
 * schéma GoTrue réel (pas de triggers, pas de toutes ses colonnes/contraintes) : elle prouve que
 * la logique de collecte/réinjection est correcte, PAS qu'elle est bit-à-bit compatible avec
 * l'implémentation interne de Supabase (ça, seule une restauration sur un vrai projet Supabase de
 * test le prouverait — hors de portée ici, cf. compte-rendu final).
 */
async function creerSchemaAuthMinimal(prisma: PrismaClient) {
  await prisma.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS auth`);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS auth.users (
      instance_id uuid,
      id uuid PRIMARY KEY,
      email text,
      encrypted_password text,
      email_confirmed_at timestamptz,
      created_at timestamptz,
      updated_at timestamptz,
      raw_app_meta_data jsonb,
      raw_user_meta_data jsonb,
      aud text,
      role text,
      confirmation_token text,
      recovery_token text,
      email_change_token_new text,
      email_change text,
      email_change_token_current text,
      phone_change text,
      phone_change_token text,
      reauthentication_token text
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS auth.identities (
      id bigserial PRIMARY KEY,
      provider_id text,
      user_id uuid,
      identity_data jsonb,
      provider text,
      last_sign_in_at timestamptz,
      created_at timestamptz,
      updated_at timestamptz
    )
  `);
}

function dirTemporaire() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pef-restore-test-"));
}

describe("validerFormatDump — refuse net plutôt qu'une restauration fantôme", () => {
  it("refuse l'ANCIEN format plat (le bug du 14 août : User/auth.users au premier niveau)", () => {
    const ancienFormat = { User: [{ id: "1" }], "auth.users": [{ id: "1" }], Config: [] };
    expect(() => validerFormatDump(ancienFormat)).toThrow(/[Nn]on reconnu/);
  });

  it("refuse un fichier sans clé `models`", () => {
    expect(() => validerFormatDump({ exportedAt: "2026-08-15T00:00:00.000Z", meta: {} })).toThrow();
  });

  it("refuse un fichier avec `models` VIDE (zéro table) — jamais de restauration silencieuse de rien", () => {
    expect(() =>
      validerFormatDump({ exportedAt: "x", meta: { totalRows: 0, tablesIgnorees: [] }, models: {} })
    ).toThrow(/AUCUNE/);
  });

  it("refuse un JSON qui n'est pas un objet (tableau, primitif...)", () => {
    expect(() => validerFormatDump([1, 2, 3])).toThrow();
    expect(() => validerFormatDump("pas un objet")).toThrow();
    expect(() => validerFormatDump(null)).toThrow();
  });

  it("accepte le format ACTUEL (models + auth)", () => {
    const dump = { exportedAt: "x", meta: { totalRows: 1, tablesIgnorees: [] }, models: { Config: [] }, auth: { users: [], identities: [] } };
    expect(() => validerFormatDump(dump)).not.toThrow();
  });
});

describe("verifierPasProduction — garde-fou contre une restauration accidentelle en production", () => {
  it("refuse si NOUVEAU_DIRECT_URL == DATABASE_URL ou DIRECT_URL du .env", () => {
    const env = { DATABASE_URL: "postgresql://prod/db", DIRECT_URL: "postgresql://prod-direct/db" };
    expect(() => verifierPasProduction("postgresql://prod/db", env)).toThrow(/REFUS/);
    expect(() => verifierPasProduction("postgresql://prod-direct/db", env)).toThrow(/REFUS/);
  });

  it("laisse passer une URL clairement différente (base de restauration dédiée)", () => {
    const env = { DATABASE_URL: "postgresql://prod/db", DIRECT_URL: "postgresql://prod-direct/db" };
    expect(() => verifierPasProduction("postgresql://autre-projet-supabase/db", env)).not.toThrow();
  });
});

describe("cycle complet : source fabriquée → backup-json.ts → restaurer-depuis-backup.ts → comparaison", () => {
  let source: Awaited<ReturnType<typeof creerBaseTest>>;
  let cible: Awaited<ReturnType<typeof creerBaseTest>>;
  const idUser = randomUUID();
  const idEmployeeSansCompte = randomUUID(); // preuve que le round-trip ne dépend pas d'1 seul id

  beforeAll(async () => {
    source = await creerBaseTest();
    cible = await creerBaseTest();

    // --- Données FABRIQUÉES côté source (jamais de vraies données) ---
    await source.prisma.config.create({
      data: { tauxChangeCDF: 2800, anneeCourante: 2026, moisCourant: 8 },
    });
    await source.prisma.jourFerie.create({
      data: { date: new Date("2026-01-01"), designation: "Nouvel An (fabriqué)", annee: 2026 },
    });
    const employe = await source.prisma.employee.create({
      data: {
        matricule: "TEST01-PEF", nom: "Fabriquée Test", sexe: "F", etatCivil: "Célibataire",
        poste: "Testeuse", secteur: "QA", categorie: "BACKOFFICE",
        salaireMensuel: 321.5, dateEmbauche: new Date("2026-01-15"), contrat: "CDI",
        id: idEmployeeSansCompte,
      },
    });
    await source.prisma.user.create({
      data: { id: idUser, email: "fixture-restauration@example.test", nom: "Compte Fixture", role: "ADMIN", actif: true },
    });

    // --- Comptes de connexion (schéma auth reconstitué à la main, cf. en-tête) ---
    await creerSchemaAuthMinimal(source.prisma);
    await source.prisma.$executeRawUnsafe(
      `INSERT INTO auth.users (instance_id, id, email, encrypted_password, aud, role)
       VALUES ('00000000-0000-0000-0000-000000000000', $1::uuid, $2, $3, 'authenticated', 'authenticated')`,
      idUser, "fixture-restauration@example.test", "$2a$fixture-hash-non-reel"
    );
    await source.prisma.$executeRawUnsafe(
      `INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
       VALUES ($1::uuid, $1::uuid, $2::jsonb, 'email', now(), now())`,
      idUser, JSON.stringify({ sub: idUser, email: "fixture-restauration@example.test", email_verified: true, phone_verified: false })
    );

    // Cible : même schéma applicatif (creerBaseTest le pousse déjà) + schéma auth reconstitué,
    // comme un projet Supabase neuf où auth.users/auth.identities existent déjà mais sont vides.
    await creerSchemaAuthMinimal(cible.prisma);
  }, 240_000);

  afterAll(async () => {
    await source?.fermer?.();
    await cible?.fermer?.();
  });

  let fichierBackup: string;
  let dump: DumpValide;

  it("backup-json.ts produit un fichier avec les modèles ET les comptes de connexion sous des clés distinctes", async () => {
    const dir = dirTemporaire();
    const resultat = await executerSauvegarde(source.prisma, dir, new Date("2026-08-15T21:00:00.000Z"));
    fichierBackup = resultat.file;
    expect(fs.existsSync(fichierBackup)).toBe(true);

    const contenu = JSON.parse(fs.readFileSync(fichierBackup, "utf-8"));
    expect(contenu.models.Config).toHaveLength(1);
    expect(contenu.models.Employee).toHaveLength(1);
    expect(contenu.models.User).toHaveLength(1);
    expect(contenu.auth.users).toHaveLength(1);
    expect(contenu.auth.users[0].email).toBe("fixture-restauration@example.test");
    expect(contenu.auth.identities).toHaveLength(1);
    // Le schéma auth EXISTE ici (reconstitué) : il ne doit PAS apparaître comme ignoré.
    expect(contenu.meta.tablesIgnorees.map((t: { table: string }) => t.table)).not.toContain("auth.users");
  });

  it("le fichier produit passe la validation de format (refus évité)", () => {
    dump = JSON.parse(fs.readFileSync(fichierBackup, "utf-8")) as DumpValide;
    expect(() => validerFormatDump(dump)).not.toThrow();
  });

  let dst: Client;
  let resultatRestauration: Awaited<ReturnType<typeof executerRestauration>>;

  it("restaurer-depuis-backup.ts restaure dans la base cible (vide, schéma à jour)", async () => {
    dst = new Client({ connectionString: cible.url });
    await dst.connect();
    resultatRestauration = await executerRestauration(dst, dump);

    expect(resultatRestauration.tables.Config).toEqual({ lues: 1, inserees: 1 });
    expect(resultatRestauration.tables.Employee).toEqual({ lues: 1, inserees: 1 });
    expect(resultatRestauration.tables.User).toEqual({ lues: 1, inserees: 1 });
    expect(resultatRestauration.authUsers).toEqual({ lues: 1, inserees: 1 });
    expect(resultatRestauration.authIdentities).toEqual({ lues: 1, inserees: 1 });
    // CONSTAT (pas l'objet de ce lot, mais que ce test révèle et qu'il faut savoir) : `ORDRE` ne
    // couvre que les 22 modèles « RH/paie » historiques. Le schéma Prisma en compte aujourd'hui
    // bien plus (modules Stock & Achats, Exploitation...) : toutes ces tables reviennent dans
    // `tablesNonPlacees`, donc NE SONT PAS restaurées par ce script en l'état. On vérifie ici que
    // le signalement fonctionne (c'est le livrable demandé), pas qu'elles sont couvertes.
    expect(resultatRestauration.tablesNonPlacees.length).toBeGreaterThan(20);
    expect(resultatRestauration.tablesNonPlacees).toEqual(expect.arrayContaining(["Shift", "PlanningCreneau", "ArticleStock"]));
    // Les tables de ORDRE, elles, ont bien toutes été trouvées dans ce fichier (rien d'oublié
    // PARMI CELLES QUE ce script sait restaurer).
    expect(resultatRestauration.tablesAbsentesDuFichier).toEqual([]);
  });

  it("comparaison — mêmes tables, mêmes nombres de lignes, mêmes valeurs (échantillon)", async () => {
    const configCible = await cible.prisma.config.findMany();
    expect(configCible).toHaveLength(1);
    expect(Number(configCible[0].tauxChangeCDF)).toBe(2800);
    expect(configCible[0].anneeCourante).toBe(2026);

    const employeCible = await cible.prisma.employee.findFirst({ where: { id: idEmployeeSansCompte } });
    expect(employeCible).not.toBeNull();
    expect(employeCible?.matricule).toBe("TEST01-PEF");
    expect(employeCible?.nom).toBe("Fabriquée Test");
    expect(Number(employeCible?.salaireMensuel)).toBe(321.5);

    const userCible = await cible.prisma.user.findUnique({ where: { id: idUser } });
    expect(userCible).not.toBeNull();
    expect(userCible?.email).toBe("fixture-restauration@example.test");
    expect(userCible?.role).toBe("ADMIN");

    const jourFerieCible = await cible.prisma.jourFerie.findMany();
    expect(jourFerieCible).toHaveLength(1);
    expect(jourFerieCible[0].designation).toBe("Nouvel An (fabriqué)");
  });

  it("les comptes de connexion sont restaurés : login réel possible (auth.users + auth.identities)", async () => {
    const { rows: usersRows } = await dst.query(`SELECT * FROM auth.users WHERE id = $1::uuid`, [idUser]);
    expect(usersRows).toHaveLength(1);
    expect(usersRows[0].email).toBe("fixture-restauration@example.test");
    expect(usersRows[0].encrypted_password).toBe("$2a$fixture-hash-non-reel");
    // Le piège documenté : les colonnes de jetons doivent être '' et non NULL.
    expect(usersRows[0].confirmation_token).toBe("");
    expect(usersRows[0].recovery_token).toBe("");

    const { rows: identitiesRows } = await dst.query(`SELECT * FROM auth.identities WHERE user_id = $1::uuid`, [idUser]);
    expect(identitiesRows).toHaveLength(1);
    expect(identitiesRows[0].provider).toBe("email");
    expect(identitiesRows[0].identity_data.email).toBe("fixture-restauration@example.test");
  });

  it("clôture la connexion cible", async () => {
    await dst.end();
  });
});

describe("cas d'alerte — table de ORDRE absente du fichier, et table du fichier non placée", () => {
  let cible: Awaited<ReturnType<typeof creerBaseTest>>;

  beforeAll(async () => {
    cible = await creerBaseTest();
    await creerSchemaAuthMinimal(cible.prisma);
  }, 240_000);

  afterAll(async () => {
    await cible?.fermer?.();
  });

  it("signale une table de ORDRE absente du fichier (modèle oublié dans la sauvegarde)", async () => {
    const dump: DumpValide = {
      exportedAt: "x",
      meta: { totalRows: 1, tablesIgnorees: [] },
      models: { Config: [{ id: "singleton", tauxChangeCDF: "2800", anneeCourante: 2026, moisCourant: 8, jourPaie: 30, espaceEmployeActif: false, updatedAt: new Date().toISOString() }] },
      // "JourFerie" et toutes les autres tables de ORDRE sont ABSENTES du fichier.
      auth: { users: [], identities: [] },
    };
    const dst = new Client({ connectionString: cible.url });
    await dst.connect();
    try {
      const resultat = await executerRestauration(dst, dump);
      expect(resultat.tablesAbsentesDuFichier).toContain("JourFerie");
      expect(resultat.tablesAbsentesDuFichier).toContain("Employee");
      expect(resultat.tablesAbsentesDuFichier).not.toContain("Config"); // Config, elle, était présente
    } finally {
      await dst.end();
    }
  });

  it("signale une table du fichier que ce script ne sait pas placer (absente de ORDRE)", async () => {
    const dump: DumpValide = {
      exportedAt: "x",
      meta: { totalRows: 0, tablesIgnorees: [] },
      models: { Config: [], TableInconnueDuScript: [{ id: "1" }] },
      auth: { users: [], identities: [] },
    };
    expect(ORDRE).not.toContain("TableInconnueDuScript");
    const dst = new Client({ connectionString: cible.url });
    await dst.connect();
    try {
      const resultat = await executerRestauration(dst, dump);
      expect(resultat.tablesNonPlacees).toEqual(["TableInconnueDuScript"]);
    } finally {
      await dst.end();
    }
  });
});

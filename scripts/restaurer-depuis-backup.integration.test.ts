import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { Prisma, PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";
import { executerSauvegarde } from "./backup-json";
import {
  validerFormatDump,
  verifierPasProduction,
  executerRestauration,
  calculerPlanInsertion,
  type DumpValide,
  type FkEdge,
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

/**
 * `calculerPlanInsertion` est PURE (aucune base de données) : elle est testée ici avec des
 * modèles/arêtes FABRIQUÉS, ce qui permet de prouver des cas qui n'existent PAS (encore) dans le
 * vrai schéma — notamment un cycle réel entre deux tables — sans devoir modifier `schema.prisma`
 * (interdit). Le cas réel du schéma actuel (FicheTechnique/IngredientFiche, aucun cycle) est,
 * lui, prouvé plus bas par le test d'intégration de bout en bout.
 */
describe("calculerPlanInsertion — auto-références et cycles (unitaire, sans base)", () => {
  it("une auto-référence (table qui pointe vers elle-même) ne bloque PAS l'ordre des tables", () => {
    const edges: FkEdge[] = [{ table: "Noeud", column: "parentId", refTable: "Noeud", nullable: true }];
    const plan = calculerPlanInsertion(["Noeud", "Autre"], edges);
    expect(plan.ordre.sort()).toEqual(["Autre", "Noeud"]);
    expect(plan.autoReferences).toEqual({ Noeud: ["parentId"] });
    // Une auto-référence se résout en réordonnant les LIGNES (cf. trierLignesAutoReferentes),
    // jamais en différant une colonne : elle ne doit donc apparaître dans AUCUNE des deux tables.
    expect(plan.colonnesDifferees.Noeud ?? []).toEqual([]);
  });

  it("un cycle réel entre 2 tables, cassable via une colonne NULLABLE, est résolu et signalé (colonne différée)", () => {
    // A requiert B (obligatoire) ; B référence optionnellement A (nullable) → cycle A<->B.
    const edges: FkEdge[] = [
      { table: "A", column: "bId", refTable: "B", nullable: false },
      { table: "B", column: "aId", refTable: "A", nullable: true },
    ];
    const plan = calculerPlanInsertion(["A", "B"], edges);
    // B doit précéder A (seule la contrainte obligatoire A->B subsiste après résolution).
    expect(plan.ordre.indexOf("B")).toBeLessThan(plan.ordre.indexOf("A"));
    // La colonne NULLABLE (B.aId) est celle qui a été différée — jamais une colonne obligatoire.
    expect(plan.colonnesDifferees).toEqual({ B: ["aId"] });
  });

  it("un cycle réel formé UNIQUEMENT de clés étrangères OBLIGATOIRES est irréductible — refus net, jamais contourné en silence", () => {
    const edges: FkEdge[] = [
      { table: "X", column: "yId", refTable: "Y", nullable: false },
      { table: "Y", column: "xId", refTable: "X", nullable: false },
    ];
    expect(() => calculerPlanInsertion(["X", "Y"], edges)).toThrow(/[Cc]ycle/);
  });

  it("ne casse rien sur un graphe simple sans cycle ni auto-référence (cas courant)", () => {
    const edges: FkEdge[] = [
      { table: "Ligne", column: "commandeId", refTable: "Commande", nullable: false },
      { table: "Commande", column: "fournisseurId", refTable: "Fournisseur", nullable: true },
    ];
    const plan = calculerPlanInsertion(["Fournisseur", "Commande", "Ligne"], edges);
    expect(plan.ordre.indexOf("Fournisseur")).toBeLessThan(plan.ordre.indexOf("Commande"));
    expect(plan.ordre.indexOf("Commande")).toBeLessThan(plan.ordre.indexOf("Ligne"));
    expect(plan.autoReferences).toEqual({});
    expect(plan.colonnesDifferees).toEqual({});
  });
});

describe("cycle complet : source fabriquée → backup-json.ts → restaurer-depuis-backup.ts → comparaison", () => {
  let source: Awaited<ReturnType<typeof creerBaseTest>>;
  let cible: Awaited<ReturnType<typeof creerBaseTest>>;
  const idUser = randomUUID();
  const idEmployeeSansCompte = randomUUID(); // preuve que le round-trip ne dépend pas d'1 seul id

  // --- Stock & Achats : ArticleStock ET ses dépendants (Stock, MouvementStock) ---
  const idFournisseur = randomUUID();
  const idCategorieStock = randomUUID();
  const idArticleStock = randomUUID();

  // --- Fiches techniques AVEC une sous-recette : le cas auto-référent réel (une FicheTechnique
  // citée par un IngredientFiche d'une AUTRE fiche, via `sousFicheId`) — cf. calculerPlanInsertion.
  const idFicheSousRecette = randomUUID(); // "Sauce tomate maison" (rendement en g)
  const idFicheParent = randomUUID(); // "Pâtes bolognaise" (utilise la sauce comme ingrédient)

  // Ids auto-incrémentés (Exploitation) capturés au moment de la création.
  let idCompteTresorerie: number;
  let idRubrique: number;
  let idCategorieExploitation: number;
  let idEcritureCaisse: number;

  beforeAll(async () => {
    source = await creerBaseTest();
    cible = await creerBaseTest();

    // --- RH/paie : Données FABRIQUÉES côté source (jamais de vraies données) ---
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

    // --- Stock & Achats : ArticleStock + ses dépendants (Fournisseur/CategorieStock en amont,
    // Stock/MouvementStock en aval) ---
    await source.prisma.fournisseur.create({ data: { id: idFournisseur, nom: "Grossiste Fabriqué" } });
    await source.prisma.categorieStock.create({
      data: { id: idCategorieStock, nom: "Farines (fabriquée)", domaine: "NOURRITURE" },
    });
    await source.prisma.articleStock.create({
      data: {
        id: idArticleStock, designation: "Farine de blé (fabriquée)", domaine: "NOURRITURE",
        categorieId: idCategorieStock, fournisseurId: idFournisseur, unite: "Kg",
      },
    });
    await source.prisma.stock.create({
      data: { articleId: idArticleStock, quantite: 120.5, stockMinimum: 20 },
    });
    await source.prisma.mouvementStock.create({
      data: { articleId: idArticleStock, type: "ENTREE", quantite: 50, origine: "Réception fabriquée" },
    });

    // --- Exploitation ---
    const compte = await source.prisma.compteTresorerie.create({ data: { nom: "Caisse fabriquée" } });
    idCompteTresorerie = compte.id;
    const rubrique = await source.prisma.rubrique.create({ data: { nom: "Achats (fabriquée)", sens: "DEPENSE" } });
    idRubrique = rubrique.id;
    const categorieExploitation = await source.prisma.categorie.create({
      data: { nom: "Matières premières (fabriquée)", rubriqueId: idRubrique },
    });
    idCategorieExploitation = categorieExploitation.id;
    const ecriture = await source.prisma.ecritureCaisse.create({
      data: {
        date: new Date("2026-08-10"), sens: "DEPENSE", rubriqueId: idRubrique, categorieId: idCategorieExploitation,
        denomination: "Achat farine (fabriqué)", compteId: idCompteTresorerie,
        montantOrigine: 45000, devise: "CDF", tauxChangeUtilise: 2800, montantUSD: 16.07,
      },
    });
    idEcritureCaisse = ecriture.id;

    // --- Fiches techniques AVEC une sous-recette : la sous-recette (fiche B) est créée d'abord,
    // puis la fiche parente (fiche A) l'utilise comme INGRÉDIENT via `sousFicheId` — un
    // IngredientFiche d'UNE fiche pointe vers une AUTRE FicheTechnique. ---
    await source.prisma.ficheTechnique.create({
      data: { id: idFicheSousRecette, nom: "Sauce tomate maison (fabriquée)", estSousRecette: true, rendementQuantite: 2000, rendementUnite: "g" },
    });
    await source.prisma.ficheTechnique.create({
      data: { id: idFicheParent, nom: "Pâtes bolognaise (fabriquée)", nbPortions: 4 },
    });
    // Ingrédient « feuille » : renvoie vers ArticleStock (croise Stock & Achats et Fiches techniques).
    await source.prisma.ingredientFiche.create({
      data: { ficheId: idFicheParent, articleId: idArticleStock, unite: "g", quantite: 300 },
    });
    // Ingrédient « sous-recette » : renvoie vers une AUTRE FicheTechnique — le cas auto-référent réel.
    await source.prisma.ingredientFiche.create({
      data: { ficheId: idFicheParent, sousFicheId: idFicheSousRecette, unite: "g", quantite: 150 },
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
    // RH/paie
    expect(contenu.models.Config).toHaveLength(1);
    expect(contenu.models.Employee).toHaveLength(1);
    expect(contenu.models.User).toHaveLength(1);
    // Stock & Achats — ArticleStock ET ses dépendants
    expect(contenu.models.Fournisseur).toHaveLength(1);
    expect(contenu.models.CategorieStock).toHaveLength(1);
    expect(contenu.models.ArticleStock).toHaveLength(1);
    expect(contenu.models.Stock).toHaveLength(1);
    expect(contenu.models.MouvementStock).toHaveLength(1);
    // Exploitation
    expect(contenu.models.CompteTresorerie).toHaveLength(1);
    expect(contenu.models.Rubrique).toHaveLength(1);
    expect(contenu.models.Categorie).toHaveLength(1);
    expect(contenu.models.EcritureCaisse).toHaveLength(1);
    // Fiches techniques — la sous-recette ET la fiche qui la cite
    expect(contenu.models.FicheTechnique).toHaveLength(2);
    expect(contenu.models.IngredientFiche).toHaveLength(2);
    // Comptes de connexion
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
    expect(resultatRestauration.tables.Fournisseur).toEqual({ lues: 1, inserees: 1 });
    expect(resultatRestauration.tables.CategorieStock).toEqual({ lues: 1, inserees: 1 });
    expect(resultatRestauration.tables.ArticleStock).toEqual({ lues: 1, inserees: 1 });
    expect(resultatRestauration.tables.Stock).toEqual({ lues: 1, inserees: 1 });
    expect(resultatRestauration.tables.MouvementStock).toEqual({ lues: 1, inserees: 1 });
    expect(resultatRestauration.tables.CompteTresorerie).toEqual({ lues: 1, inserees: 1 });
    expect(resultatRestauration.tables.Rubrique).toEqual({ lues: 1, inserees: 1 });
    expect(resultatRestauration.tables.Categorie).toEqual({ lues: 1, inserees: 1 });
    expect(resultatRestauration.tables.EcritureCaisse).toEqual({ lues: 1, inserees: 1 });
    expect(resultatRestauration.tables.FicheTechnique).toEqual({ lues: 2, inserees: 2 });
    expect(resultatRestauration.tables.IngredientFiche).toEqual({ lues: 2, inserees: 2 });
    expect(resultatRestauration.authUsers).toEqual({ lues: 1, inserees: 1 });
    expect(resultatRestauration.authIdentities).toEqual({ lues: 1, inserees: 1 });

    // LE TROU SIGNALÉ EST FERMÉ : plus aucune table (Stock & Achats, Exploitation, Fiches
    // techniques, plannings...) ne revient NON PLACÉE — l'ordre est désormais déduit du schéma
    // lui-même, il ne peut plus prendre de retard sur lui.
    expect(resultatRestauration.tablesNonPlacees).toEqual([]);
    expect(resultatRestauration.tablesAbsentesDuFichier).toEqual([]);
  });

  it("verrou de régression : le plan calculé couvre TOUS les modèles du schéma, sans exception codée en dur", () => {
    // Dérivé de Prisma.dmmf EN DIRECT (pas d'une copie figée dans ce test) : si un nouveau modèle
    // apparaît un jour dans schema.prisma, ce test le voit automatiquement, sans être modifié.
    const modelesDuSchema = Prisma.dmmf.datamodel.models.map((m) => m.name);
    expect(modelesDuSchema.length).toBeGreaterThan(0); // garde-fou trivial : jamais un plan sur 0 modèle
    expect(resultatRestauration.plan.ordre).toHaveLength(modelesDuSchema.length);
    expect(new Set(resultatRestauration.plan.ordre)).toEqual(new Set(modelesDuSchema));
  });

  it("comparaison table par table (TOUTES les tables du fichier) — mêmes nombres de lignes qu'en source", async () => {
    const client = cible.prisma as unknown as Record<string, { count: () => Promise<number> } | undefined>;
    const ecarts: string[] = [];
    for (const [table, rows] of Object.entries(dump.models)) {
      const delegate = client[table.charAt(0).toLowerCase() + table.slice(1)];
      if (!delegate?.count) continue;
      const compte = await delegate.count();
      if (compte !== rows.length) ecarts.push(`${table} : source=${rows.length} cible=${compte}`);
    }
    expect(ecarts).toEqual([]);
  });

  it("comparaison — RH/paie : mêmes valeurs (échantillon)", async () => {
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

  it("comparaison — Stock & Achats : ArticleStock ET ses dépendants (Stock, MouvementStock)", async () => {
    const articleCible = await cible.prisma.articleStock.findUnique({ where: { id: idArticleStock } });
    expect(articleCible).not.toBeNull();
    expect(articleCible?.designation).toBe("Farine de blé (fabriquée)");
    expect(articleCible?.categorieId).toBe(idCategorieStock);
    expect(articleCible?.fournisseurId).toBe(idFournisseur);

    const stockCible = await cible.prisma.stock.findUnique({ where: { articleId: idArticleStock } });
    expect(stockCible).not.toBeNull();
    expect(Number(stockCible?.quantite)).toBe(120.5);

    const mouvementCible = await cible.prisma.mouvementStock.findFirst({ where: { articleId: idArticleStock } });
    expect(mouvementCible).not.toBeNull();
    expect(mouvementCible?.type).toBe("ENTREE");
    expect(Number(mouvementCible?.quantite)).toBe(50);
  });

  it("comparaison — Exploitation : EcritureCaisse et ses 2 comptes (compte + rubrique + catégorie)", async () => {
    const ecritureCible = await cible.prisma.ecritureCaisse.findUnique({ where: { id: idEcritureCaisse } });
    expect(ecritureCible).not.toBeNull();
    expect(ecritureCible?.compteId).toBe(idCompteTresorerie);
    expect(ecritureCible?.rubriqueId).toBe(idRubrique);
    expect(ecritureCible?.categorieId).toBe(idCategorieExploitation);
    expect(Number(ecritureCible?.montantOrigine)).toBe(45000);
  });

  it("comparaison — Fiches techniques : la sous-recette est bien référencée par l'ingrédient de la fiche parente", async () => {
    const sousRecetteCible = await cible.prisma.ficheTechnique.findUnique({ where: { id: idFicheSousRecette } });
    expect(sousRecetteCible).not.toBeNull();
    expect(sousRecetteCible?.estSousRecette).toBe(true);

    const ficheParenteCible = await cible.prisma.ficheTechnique.findUnique({ where: { id: idFicheParent } });
    expect(ficheParenteCible).not.toBeNull();

    const ingredientsCible = await cible.prisma.ingredientFiche.findMany({
      where: { ficheId: idFicheParent },
      orderBy: { quantite: "desc" },
    });
    expect(ingredientsCible).toHaveLength(2);
    const ingredientArticle = ingredientsCible.find((i) => i.articleId !== null);
    const ingredientSousRecette = ingredientsCible.find((i) => i.sousFicheId !== null);
    expect(ingredientArticle?.articleId).toBe(idArticleStock);
    // LE CAS AUTO-RÉFÉRENT RÉEL : l'IngredientFiche de la fiche PARENTE pointe vers la fiche
    // SOUS-RECETTE (une autre ligne de la MÊME table FicheTechnique) — round-trip vérifié.
    expect(ingredientSousRecette?.sousFicheId).toBe(idFicheSousRecette);
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

describe("cas d'alerte — table du schéma actuel absente du fichier, et table du fichier absente du schéma", () => {
  let cible: Awaited<ReturnType<typeof creerBaseTest>>;

  beforeAll(async () => {
    cible = await creerBaseTest();
    await creerSchemaAuthMinimal(cible.prisma);
  }, 240_000);

  afterAll(async () => {
    await cible?.fermer?.();
  });

  it("signale une table du schéma actuel absente du fichier (modèle oublié dans la sauvegarde)", async () => {
    const dump: DumpValide = {
      exportedAt: "x",
      meta: { totalRows: 1, tablesIgnorees: [] },
      models: { Config: [{ id: "singleton", tauxChangeCDF: "2800", anneeCourante: 2026, moisCourant: 8, jourPaie: 30, espaceEmployeActif: false, updatedAt: new Date().toISOString() }] },
      // "JourFerie" et toutes les autres tables du schéma actuel sont ABSENTES du fichier.
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

  it("signale une table du fichier que ce script ne sait pas placer (absente du schéma actuel — sauvegarde plus ancienne)", async () => {
    const dump: DumpValide = {
      exportedAt: "x",
      meta: { totalRows: 0, tablesIgnorees: [] },
      models: { Config: [], TableInconnueDuScript: [{ id: "1" }] },
      auth: { users: [], identities: [] },
    };
    expect(Prisma.dmmf.datamodel.models.map((m) => m.name)).not.toContain("TableInconnueDuScript");
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

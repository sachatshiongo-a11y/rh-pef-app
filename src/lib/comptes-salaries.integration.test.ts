import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// La création des comptes salariés — à l'unité (fiche employé) et en lot (Paramètres) — contre une
// VRAIE base (Postgres embarqué). Supabase Auth est un service EXTERNE : `@/lib/securite-connexion`
// est remplacé par un double qui retient, par e-mail, le mot de passe qu'on lui a confié (c'est ce
// que Supabase connaîtrait), et qui sait tomber en panne sur un e-mail donné. Aucun compte réel
// n'est créé. La session est mockée comme dans `parametres/pointage-actions.integration.test.ts`.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
const A = vi.hoisted(() => ({ user: { id: "seed", role: "ADMIN" as string, nom: "Direction", employeeId: null as string | null } }));
const AUTH = vi.hoisted(() => ({
  motsDePasse: new Map<string, string>(), // e-mail → mot de passe confié à « Supabase »
  enPanne: new Set<string>(), // e-mails pour lesquels la création Auth échoue
  creations: 0,
  suppressions: [] as string[],
  changementsMotDePasse: 0,
}));
const PDF = vi.hoisted(() => ({ enPanne: false }));

vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));
vi.mock("@/lib/auth", () => ({
  verifySession: async () => A.user,
  requireRole: (user: { role: string }, allowed: string[]) => {
    if (!allowed.includes(user.role)) throw new Error("Accès refusé : rôle insuffisant.");
  },
  invaliderProfil: () => {},
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/securite-connexion", () => ({
  creerUtilisateurAuth: async (email: string, motDePasse: string) => {
    AUTH.creations++;
    if (AUTH.enPanne.has(email)) throw new Error("Échec de la création du compte (500).");
    AUTH.motsDePasse.set(email, motDePasse);
    return randomUUID();
  },
  supprimerUtilisateurAuth: async (id: string) => {
    AUTH.suppressions.push(id);
  },
  changerMotDePasseAdmin: async () => {
    AUTH.changementsMotDePasse++;
  },
}));
vi.mock("@/lib/pdf/fiches-connexion", async (original) => {
  const vrai = await original<typeof import("@/lib/pdf/fiches-connexion")>();
  return {
    ...vrai,
    genererFichesConnexionPdf: (p: Parameters<typeof vrai.genererFichesConnexionPdf>[0]) =>
      PDF.enPanne ? Promise.reject(new Error("rendu impossible")) : vrai.genererFichesConnexionPdf(p),
  };
});

const { creerCompteSalarie, RefusCompteSalarie } = await import("./comptes-salaries");
const { creerCompteEmploye } = await import("@/app/(app)/employes/compte-actions");
const { creerComptesEnLot } = await import("@/app/(app)/parametres/comptes-lot-actions");
const { emailInterneMatricule } = await import("@/lib/espace-employe");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let adminId: string;
let seq = 0;

async function salarie(nom: string, opts: { actif?: boolean } = {}) {
  seq++;
  const e = await prisma.employee.create({
    data: {
      matricule: `CL${String(seq).padStart(2, "0")}-PEF`, nom, sexe: "F", etatCivil: "Célibataire",
      poste: "Test", secteur: "Salle", categorie: "BRIGADE", salaireMensuel: 300,
      dateEmbauche: new Date("2025-01-01"), contrat: "CDI", actif: opts.actif ?? true,
    },
  });
  return e;
}

/** Un compte déjà en place, dans un état qu'une réinitialisation changerait forcément. */
async function compteExistant(emp: { id: string; matricule: string; nom: string }) {
  return prisma.user.create({
    data: {
      email: emailInterneMatricule(emp.matricule), nom: emp.nom, role: "EMPLOYE", employeeId: emp.id,
      motDePasseTemporaire: false, actif: false,
    },
  });
}

async function texteDuPdf(b64: string): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const { pages } = await new PDFParse({ data: new Uint8Array(Buffer.from(b64, "base64")) }).getText();
  return pages.map((p) => p.text).join("\n").replace(/\s+/g, " ");
}

/** Tout ce que l'application a écrit en texte : un mot de passe ne doit s'y trouver nulle part. */
async function toutLeTexteStocke(): Promise<string> {
  const [journal, users] = await Promise.all([prisma.journalAudit.findMany(), prisma.user.findMany()]);
  return JSON.stringify({ journal, users });
}

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  await prisma.config.create({
    data: { id: "singleton", tauxChangeCDF: 2800, anneeCourante: 2026, moisCourant: 9, espaceEmployeActif: true },
  });
  adminId = (await prisma.user.create({ data: { email: "direction@test.pef", nom: "Direction", role: "ADMIN" } })).id;
});

afterAll(async () => {
  await fermer?.();
});

beforeEach(async () => {
  A.user = { id: adminId, role: "ADMIN", nom: "Direction", employeeId: null };
  AUTH.motsDePasse.clear();
  AUTH.enPanne.clear();
  AUTH.creations = 0;
  AUTH.suppressions = [];
  AUTH.changementsMotDePasse = 0;
  PDF.enPanne = false;
  await prisma.config.update({ where: { id: "singleton" }, data: { espaceEmployeActif: true } });
});

describe("creerCompteSalarie — le seul chemin de création", () => {
  it("crée un compte salarié lié, à mot de passe temporaire, journalisé sans le mot de passe", async () => {
    const e = await salarie("Kabeya Éléonore");
    const r = await creerCompteSalarie(prisma, { employeeId: e.id, auteurId: adminId });

    expect(r).toEqual({ employeeId: e.id, nom: "Kabeya Éléonore", matricule: e.matricule, motDePasse: expect.stringMatching(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/) });
    const email = emailInterneMatricule(e.matricule);
    expect(AUTH.motsDePasse.get(email)).toBe(r.motDePasse); // le mot de passe rendu est celui donné à l'Auth

    const u = await prisma.user.findUniqueOrThrow({ where: { employeeId: e.id } });
    expect(u).toMatchObject({ email, nom: "Kabeya Éléonore", role: "EMPLOYE", motDePasseTemporaire: true, actif: true });
    expect(await prisma.journalAudit.findMany({ where: { entiteId: u.id }, select: { champ: true, nouvelleValeur: true, userId: true } }))
      .toEqual([{ champ: "creation", nouvelleValeur: `compte salarié ${e.matricule}`, userId: adminId }]);
    expect(await toutLeTexteStocke()).not.toContain(r.motDePasse);
  });

  it("un salarié qui a déjà un compte : refusé, et son compte n'est PAS réinitialisé", async () => {
    const e = await salarie("Déjà Compte");
    const avant = await compteExistant(e);

    await expect(creerCompteSalarie(prisma, { employeeId: e.id, auteurId: adminId })).rejects.toMatchObject({
      motif: "COMPTE_EXISTANT",
    });
    expect(AUTH.creations).toBe(0);
    expect(AUTH.changementsMotDePasse).toBe(0);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: avant.id } })).toEqual(avant);
  });

  it("un salarié inactif : refusé, aucun compte Auth", async () => {
    const e = await salarie("Parti Depuis", { actif: false });
    const err = await creerCompteSalarie(prisma, { employeeId: e.id, auteurId: adminId }).catch((x) => x);
    expect(err).toBeInstanceOf(RefusCompteSalarie);
    expect(err).toMatchObject({ motif: "INACTIF", message: "Cet employé n'est plus actif." });
    expect(AUTH.creations).toBe(0);
  });

  it("la ligne applicative échoue : le compte Auth tout juste créé est supprimé", async () => {
    const e = await salarie("Collision Email");
    // Un utilisateur NON lié porte déjà l'e-mail interne : l'écriture applicative échoue (unicité).
    await prisma.user.create({ data: { email: emailInterneMatricule(e.matricule), nom: "Autre", role: "VIEWER" } });

    await expect(creerCompteSalarie(prisma, { employeeId: e.id, auteurId: adminId })).rejects.toThrow();
    expect(AUTH.creations).toBe(1);
    expect(AUTH.suppressions).toHaveLength(1);
    expect(await prisma.user.findUnique({ where: { employeeId: e.id } })).toBeNull();
  });
});

describe("creerCompteEmploye (fiche employé) — même résultat qu'avant, par le même chemin", () => {
  it("renvoie { matricule, motDePasse } et crée le compte", async () => {
    const e = await salarie("Fiche Unitaire");
    const r = await creerCompteEmploye(e.id);
    expect(r).toEqual({ matricule: e.matricule, motDePasse: AUTH.motsDePasse.get(emailInterneMatricule(e.matricule)) });
    expect(await prisma.user.findUniqueOrThrow({ where: { employeeId: e.id } })).toMatchObject({ role: "EMPLOYE", motDePasseTemporaire: true });
  });

  it("garde ses messages : compte existant, employé inactif, espace désactivé, rôle", async () => {
    const existant = await salarie("Fiche Existante");
    await compteExistant(existant);
    expect(await creerCompteEmploye(existant.id)).toEqual({
      erreur: "Un compte existe déjà pour ce salarié. Utilisez « Réinitialiser le mot de passe ».",
    });
    const inactif = await salarie("Fiche Inactive", { actif: false });
    expect(await creerCompteEmploye(inactif.id)).toEqual({ erreur: "Cet employé n'est plus actif." });

    const libre = await salarie("Fiche Libre");
    await prisma.config.update({ where: { id: "singleton" }, data: { espaceEmployeActif: false } });
    expect(await creerCompteEmploye(libre.id)).toEqual({ erreur: "L'espace salarié n'est pas activé (Paramètres)." });
    await prisma.config.update({ where: { id: "singleton" }, data: { espaceEmployeActif: true } });
    A.user = { id: adminId, role: "MANAGER", nom: "Autre", employeeId: null };
    expect(await creerCompteEmploye(libre.id)).toEqual({ erreur: "Accès refusé : rôle insuffisant." });
    expect(AUTH.creations).toBe(0);
    expect(await prisma.user.findUnique({ where: { employeeId: libre.id } })).toBeNull();
  });
});

describe("creerComptesEnLot (Paramètres → Espace salarié)", () => {
  it("ne crée que les manquants ; un échec au MILIEU n'arrête pas le lot et n'annule rien", async () => {
    // Ordre de traitement = ordre alphabétique : « Lot B » (panne) passe entre « Lot A » et « Lot C ».
    const a = await salarie("Lot A Premier");
    const b = await salarie("Lot B Panne");
    const c = await salarie("Lot C Dernier");
    const d = await salarie("Lot D Existant");
    const i = await salarie("Lot E Inactif", { actif: false });
    const compteD = await compteExistant(d);
    AUTH.enPanne.add(emailInterneMatricule(b.matricule));

    const r = await creerComptesEnLot([c.id, d.id, b.id, i.id, a.id]);
    if ("erreur" in r) throw new Error(r.erreur);

    expect(r.crees).toEqual([
      { nom: "Lot A Premier", matricule: a.matricule },
      { nom: "Lot C Dernier", matricule: c.matricule },
    ]);
    expect(r.ignores).toEqual([
      { nom: "Lot B Panne", raison: "échec de la création : Échec de la création du compte (500)." },
      { nom: "Lot D Existant", raison: "a déjà un compte (non modifié)" },
      { nom: "Lot E Inactif", raison: "n'est plus actif" },
    ]);
    // Aucun mot de passe hors du PDF : `crees` ne porte que nom et matricule.
    expect(JSON.stringify(r.crees)).not.toMatch(/[A-Z2-9]{5}-[A-Z2-9]{5}/);

    // La base, relue : A et C ont leur compte, B n'en a pas, D est intact (non réinitialisé).
    expect(await prisma.user.findUnique({ where: { employeeId: a.id } })).toMatchObject({ role: "EMPLOYE", motDePasseTemporaire: true });
    expect(await prisma.user.findUnique({ where: { employeeId: c.id } })).toMatchObject({ role: "EMPLOYE", motDePasseTemporaire: true });
    expect(await prisma.user.findUnique({ where: { employeeId: b.id } })).toBeNull();
    expect(await prisma.user.findUnique({ where: { employeeId: i.id } })).toBeNull();
    expect(await prisma.user.findUniqueOrThrow({ where: { id: compteD.id } })).toEqual(compteD);
    expect(AUTH.changementsMotDePasse).toBe(0);

    // Le PDF porte chaque matricule créé avec LE mot de passe confié à l'Auth — et rien des autres.
    const mdpA = AUTH.motsDePasse.get(emailInterneMatricule(a.matricule))!;
    const mdpC = AUTH.motsDePasse.get(emailInterneMatricule(c.matricule))!;
    const texte = await texteDuPdf(r.pdfBase64!);
    for (const attendu of [a.matricule, mdpA, c.matricule, mdpC]) expect(texte).toContain(attendu);
    for (const absent of [b.matricule, d.matricule, i.matricule]) expect(texte).not.toContain(absent);

    // Et ces mots de passe n'ont été écrits nulle part par l'application.
    const stocke = await toutLeTexteStocke();
    expect(stocke).not.toContain(mdpA);
    expect(stocke).not.toContain(mdpC);
  }, 60_000);

  it("relancé sur les mêmes salariés : rien n'est créé ni réinitialisé, pas de PDF", async () => {
    const a = await salarie("Relance Un");
    const b = await salarie("Relance Deux");
    const premier = await creerComptesEnLot([a.id, b.id]);
    if ("erreur" in premier) throw new Error(premier.erreur);
    const avant = await prisma.user.findMany({ where: { employeeId: { in: [a.id, b.id] } }, orderBy: { email: "asc" } });
    const creationsAvant = AUTH.creations;

    const second = await creerComptesEnLot([a.id, b.id]);
    expect(second).toEqual({
      pdfBase64: null,
      crees: [],
      ignores: [
        { nom: "Relance Deux", raison: "a déjà un compte (non modifié)" },
        { nom: "Relance Un", raison: "a déjà un compte (non modifié)" },
      ],
    });
    expect(AUTH.creations).toBe(creationsAvant);
    expect(AUTH.changementsMotDePasse).toBe(0);
    expect(await prisma.user.findMany({ where: { employeeId: { in: [a.id, b.id] } }, orderBy: { email: "asc" } })).toEqual(avant);
  }, 60_000);

  it("PDF impossible à produire : l'erreur nomme les comptes créés, le recours ET les non-créés ; les comptes restent", async () => {
    const a = await salarie("Sans Fiche");
    const parti = await salarie("Sans Fiche Parti", { actif: false });
    PDF.enPanne = true;
    expect(await creerComptesEnLot([a.id, parti.id])).toEqual({
      erreur:
        "Les comptes de Sans Fiche ont été créés, mais les fiches n'ont pas pu être produites : " +
        "réinitialisez leur mot de passe depuis leur fiche employé. Non créés : Sans Fiche Parti (n'est plus actif).",
    });
    expect(await prisma.user.findUnique({ where: { employeeId: a.id } })).not.toBeNull();
  });

  it("refusé hors Direction, espace désactivé ou sélection vide : rien n'est créé", async () => {
    const a = await salarie("Garde Lot");
    for (const role of ["MANAGER", "VIEWER", "COMPTA", "STOCK", "EMPLOYE"]) {
      A.user = { id: adminId, role, nom: "Autre", employeeId: null };
      expect(await creerComptesEnLot([a.id])).toEqual({ erreur: "Accès refusé : rôle insuffisant." });
    }
    A.user = { id: adminId, role: "ADMIN", nom: "Direction", employeeId: null };
    await prisma.config.update({ where: { id: "singleton" }, data: { espaceEmployeActif: false } });
    expect(await creerComptesEnLot([a.id])).toEqual({ erreur: "L'espace salarié n'est pas activé (Paramètres)." });
    await prisma.config.update({ where: { id: "singleton" }, data: { espaceEmployeActif: true } });
    expect(await creerComptesEnLot([])).toEqual({ erreur: "Cochez au moins un salarié." });
    expect(AUTH.creations).toBe(0);
    expect(await prisma.user.findUnique({ where: { employeeId: a.id } })).toBeNull();
  });
});

describe("l'écran des comptes en lot", () => {
  it("affiche l'avertissement exact de la conception", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/app/(app)/parametres/comptes-lot.tsx"), "utf8");
    expect(source).toContain('"Ce document contient des mots de passe : remettez chaque fiche en main propre."');
    expect(source).toContain("{AVERTISSEMENT_FICHES}");
  });
});

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
  motsDePasseParId: new Map<string, string>(), // User.id → mot de passe confié par réinitialisation
  changementEnPanne: new Set<string>(), // User.id pour lesquels le changement de mot de passe échoue
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
  changerMotDePasseAdmin: async (id: string, motDePasse: string) => {
    AUTH.changementsMotDePasse++;
    if (AUTH.changementEnPanne.has(id)) throw new Error("Échec de la mise à jour du mot de passe (500).");
    AUTH.motsDePasseParId.set(id, motDePasse);
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

const { creerCompteSalarie, reinitialiserCompteSalarie, RefusCompteSalarie, etatCompteSalarie } = await import("./comptes-salaries");
const { creerCompteEmploye, reinitialiserCompteEmploye } = await import("@/app/(app)/employes/compte-actions");
const { creerComptesEnLot, nouvellesFichesEnLot } = await import("@/app/(app)/parametres/comptes-lot-actions");
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
async function compteExistant(
  emp: { id: string; matricule: string; nom: string },
  opts: { role?: "EMPLOYE" | "STOCK" | "MANAGER" | "COMPTA" | "ADMIN"; email?: string; actif?: boolean } = {},
) {
  return prisma.user.create({
    data: {
      email: opts.email ?? emailInterneMatricule(emp.matricule), nom: emp.nom, role: opts.role ?? "EMPLOYE", employeeId: emp.id,
      motDePasseTemporaire: false, actif: opts.actif ?? false,
    },
  });
}

async function texteDuPdf(b64: string): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const { pages } = await new PDFParse({ data: new Uint8Array(Buffer.from(b64, "base64")) }).getText();
  return pages.map((p) => p.text).join("\n").replace(/\s+/g, " ");
}

async function nombreDePages(b64: string): Promise<number> {
  const { PDFParse } = await import("pdf-parse");
  return (await new PDFParse({ data: new Uint8Array(Buffer.from(b64, "base64")) }).getText()).total;
}

/** Un client dont UNE opération tombe en panne ; tout le reste passe par la vraie base. */
function clientEnPanne(modele: "user" | "journalAudit", operation: string): PrismaClient {
  return new Proxy(prisma, {
    get: (t, p) => {
      const v = Reflect.get(t, p);
      if (p !== modele) return typeof v === "function" ? v.bind(t) : v;
      return new Proxy(v as object, {
        get: (m, q) => {
          if (q === operation) return async () => { throw new Error("connexion perdue"); };
          const f = Reflect.get(m, q);
          return typeof f === "function" ? f.bind(m) : f;
        },
      });
    },
  });
}

/** Une ligne de résultat, SANS son PDF : ce que l'écran reçoit en clair. */
const enClair = (f: { ficheBase64: string } & Record<string, unknown>) =>
  Object.fromEntries(Object.entries(f).filter(([cle]) => cle !== "ficheBase64"));

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
  AUTH.motsDePasseParId.clear();
  AUTH.changementEnPanne.clear();
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

    await prisma.employee.update({ where: { id: a.id }, data: { telephone: " +243 81 000 0001 " } });
    const r = await creerComptesEnLot([c.id, d.id, b.id, i.id, a.id]);
    if ("erreur" in r) throw new Error(r.erreur);

    expect(r.fiches.map(enClair)).toEqual([
      { employeeId: a.id, nom: "Lot A Premier", matricule: a.matricule, telephone: "+243 81 000 0001" },
      { employeeId: c.id, nom: "Lot C Dernier", matricule: c.matricule, telephone: null },
    ]);
    expect(r.ignores).toEqual([
      { nom: "Lot B Panne", raison: "échec de la création : Échec de la création du compte (500)." },
      { nom: "Lot D Existant", raison: "a déjà un compte (non modifié)" },
      { nom: "Lot E Inactif", raison: "n'est plus actif" },
    ]);
    // Aucun mot de passe hors des PDF : en clair, chaque ligne ne porte que nom, matricule, téléphone.
    expect(JSON.stringify(r.fiches.map(enClair))).not.toMatch(/[A-Z2-9]{5}-[A-Z2-9]{5}/);

    // La base, relue : A et C ont leur compte, B n'en a pas, D est intact (non réinitialisé).
    expect(await prisma.user.findUnique({ where: { employeeId: a.id } })).toMatchObject({ role: "EMPLOYE", motDePasseTemporaire: true });
    expect(await prisma.user.findUnique({ where: { employeeId: c.id } })).toMatchObject({ role: "EMPLOYE", motDePasseTemporaire: true });
    expect(await prisma.user.findUnique({ where: { employeeId: b.id } })).toBeNull();
    expect(await prisma.user.findUnique({ where: { employeeId: i.id } })).toBeNull();
    expect(await prisma.user.findUniqueOrThrow({ where: { id: compteD.id } })).toEqual(compteD);
    expect(AUTH.changementsMotDePasse).toBe(0);

    // La planche porte chaque matricule créé avec LE mot de passe confié à l'Auth — et rien des autres.
    const mdpA = AUTH.motsDePasse.get(emailInterneMatricule(a.matricule))!;
    const mdpC = AUTH.motsDePasse.get(emailInterneMatricule(c.matricule))!;
    const texte = await texteDuPdf(r.plancheBase64!);
    for (const attendu of [a.matricule, mdpA, c.matricule, mdpC]) expect(texte).toContain(attendu);
    for (const absent of [b.matricule, d.matricule, i.matricule]) expect(texte).not.toContain(absent);

    // Et chaque fiche INDIVIDUELLE ne porte que SON salarié, avec SON mot de passe.
    const [ficheA, ficheC] = await Promise.all(r.fiches.map((f) => texteDuPdf(f.ficheBase64)));
    expect(ficheA).toContain(a.matricule);
    expect(ficheA).toContain(mdpA);
    expect(ficheA).not.toContain(c.matricule);
    expect(ficheA).not.toContain(mdpC);
    expect(ficheC).toContain(c.matricule);
    expect(ficheC).toContain(mdpC);
    expect(ficheC).not.toContain(a.matricule);
    expect(ficheC).not.toContain(mdpA);

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
      fiches: [],
      plancheBase64: null,
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

/** Tout ce qui passe par la console pendant `fn` : un mot de passe ne doit jamais y apparaître. */
async function consoleDurant<T>(fn: () => Promise<T>): Promise<{ resultat: T; console: string }> {
  const ecrits: unknown[] = [];
  const espions = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void ecrits.push(a)),
  );
  try {
    return { resultat: await fn(), console: JSON.stringify(ecrits) };
  } finally {
    for (const e of espions) e.mockRestore();
  }
}

describe("reinitialiserCompteSalarie — le seul chemin de réinitialisation", () => {
  it("compte EMPLOYE à identifiant matricule : nouveau mot de passe temporaire, compte réactivé, jamais journalisé", async () => {
    const e = await salarie("Lydia Réinit");
    const avant = await compteExistant(e); // motDePasseTemporaire: false, actif: false

    const { resultat: r, console: sortie } = await consoleDurant(() => reinitialiserCompteSalarie(prisma, { employeeId: e.id, auteurId: adminId }));

    expect(r).toEqual({ employeeId: e.id, nom: "Lydia Réinit", matricule: e.matricule, motDePasse: expect.stringMatching(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/) });
    expect(AUTH.motsDePasseParId.get(avant.id)).toBe(r.motDePasse); // c'est CE mot de passe que l'Auth connaît
    expect(await prisma.user.findUniqueOrThrow({ where: { id: avant.id } })).toMatchObject({
      email: avant.email, role: "EMPLOYE", employeeId: e.id, motDePasseTemporaire: true, actif: true,
    });
    expect(await prisma.journalAudit.findMany({ where: { entiteId: avant.id }, select: { champ: true, nouvelleValeur: true, userId: true } }))
      .toEqual([{ champ: "reinitialisation", nouvelleValeur: "mot de passe temporaire régénéré", userId: adminId }]);
    expect(await toutLeTexteStocke()).not.toContain(r.motDePasse);
    expect(sortie).not.toContain(r.motDePasse);
  });

  it("compte STOCK à identifiant matricule (cas d'Aimée) : accepté", async () => {
    const e = await salarie("Aimée Stock");
    const compte = await compteExistant(e, { role: "STOCK", actif: true });
    const r = await reinitialiserCompteSalarie(prisma, { employeeId: e.id, auteurId: adminId });
    expect(AUTH.motsDePasseParId.get(compte.id)).toBe(r.motDePasse);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: compte.id } })).toMatchObject({ role: "STOCK", motDePasseTemporaire: true, actif: true });
  });

  it("compte à identifiant e-mail (cas d'Esther) : refus lisible, RIEN n'est modifié", async () => {
    const e = await salarie("Esther Email");
    const avant = await compteExistant(e, { role: "STOCK", email: `esther.${e.matricule.toLowerCase()}@patesenfolie.cd`, actif: true });

    const err = await reinitialiserCompteSalarie(prisma, { employeeId: e.id, auteurId: adminId }).catch((x) => x);
    expect(err).toBeInstanceOf(RefusCompteSalarie);
    expect(err).toMatchObject({
      motif: "COMPTE_PAR_EMAIL",
      message: "Ce compte se connecte par adresse e-mail, pas par le matricule : il se gère dans Paramètres → Utilisateurs & accès.",
    });
    expect(AUTH.changementsMotDePasse).toBe(0);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: avant.id } })).toEqual(avant); // base relue
    expect(await prisma.journalAudit.count({ where: { entiteId: avant.id } })).toBe(0);
  });

  it("salarié sans compte : refus, aucun appel à l'Auth", async () => {
    const e = await salarie("Sans Compte Réinit");
    await expect(reinitialiserCompteSalarie(prisma, { employeeId: e.id, auteurId: adminId })).rejects.toMatchObject({
      motif: "SANS_COMPTE",
      message: "Aucun compte salarié pour cet employé.",
    });
    expect(AUTH.changementsMotDePasse).toBe(0);
    expect(await prisma.user.findUnique({ where: { employeeId: e.id } })).toBeNull();
  });

  it("compte MANAGER ou COMPTA relié et identifié par matricule : refusé, RIEN n'est modifié", async () => {
    for (const role of ["MANAGER", "COMPTA"] as const) {
      const e = await salarie(`Rôle ${role}`);
      const avant = await compteExistant(e, { role, actif: true });
      const err = await reinitialiserCompteSalarie(prisma, { employeeId: e.id, auteurId: adminId }).catch((x) => x);
      expect(err, role).toBeInstanceOf(RefusCompteSalarie);
      expect(err, role).toMatchObject({
        motif: "ROLE_NON_SALARIE",
        message: "Ce compte n'est ni un compte salarié ni un compte Stock : il se gère dans Paramètres → Utilisateurs & accès.",
      });
      expect(await prisma.user.findUniqueOrThrow({ where: { id: avant.id } })).toEqual(avant); // base relue
      expect(await prisma.journalAudit.count({ where: { entiteId: avant.id } })).toBe(0);
    }
    expect(AUTH.changementsMotDePasse).toBe(0);
  });

  it("la base ou le journal échoue APRÈS l'Auth : l'erreur dit la vérité, sans le mot de passe", async () => {
    for (const [modele, operation] of [["user", "update"], ["journalAudit", "create"]] as const) {
      const e = await salarie(`Moitié ${modele}`);
      const compte = await compteExistant(e);
      const { resultat: err, console: sortie } = await consoleDurant(() =>
        reinitialiserCompteSalarie(clientEnPanne(modele, operation), { employeeId: e.id, auteurId: adminId }).catch((x) => x),
      );
      const mdp = AUTH.motsDePasseParId.get(compte.id)!;
      expect(mdp, modele).toBeTruthy(); // l'Auth l'a bien changé : l'ancien ne marche plus
      expect(err, modele).toBeInstanceOf(Error);
      expect((err as Error).message, modele).toBe(
        "Mot de passe changé mais non enregistré : l'ancien ne marche plus, refaites “Nouvelle fiche” pour ce salarié.",
      );
      expect(JSON.stringify({ message: (err as Error).message, sortie }), modele).not.toContain(mdp);
    }
  });

  it("l'Auth refuse le changement : la ligne applicative n'est pas touchée", async () => {
    const e = await salarie("Panne Auth Réinit");
    const avant = await compteExistant(e);
    AUTH.changementEnPanne.add(avant.id);
    await expect(reinitialiserCompteSalarie(prisma, { employeeId: e.id, auteurId: adminId })).rejects.toThrow("(500)");
    expect(await prisma.user.findUniqueOrThrow({ where: { id: avant.id } })).toEqual(avant);
  });

  it("l'état affiché dans Paramètres suit la même règle d'identifiant", () => {
    expect(etatCompteSalarie("AM22-PEF", null)).toBe("SANS_COMPTE");
    expect(etatCompteSalarie("AM22-PEF", { email: "am22pef@salarie.local", actif: true })).toBe("ACTIF");
    expect(etatCompteSalarie("AM22-PEF", { email: "AM22PEF@salarie.local", actif: false })).toBe("DESACTIVE");
    expect(etatCompteSalarie("EN05-PEF", { email: "esthernsundi@patesenfolie.cd", actif: true })).toBe("PAR_EMAIL");
  });
});

describe("reinitialiserCompteEmploye (fiche employé) — même résultat qu'avant, par le même chemin", () => {
  it("renvoie { matricule, motDePasse } : le mot de passe que l'Auth connaît", async () => {
    const e = await salarie("Fiche Réinit");
    const compte = await compteExistant(e);
    const r = await reinitialiserCompteEmploye(e.id);
    expect(r).toEqual({ matricule: e.matricule, motDePasse: AUTH.motsDePasseParId.get(compte.id) });
    expect(await prisma.user.findUniqueOrThrow({ where: { id: compte.id } })).toMatchObject({ motDePasseTemporaire: true, actif: true });
  });

  it("garde ses refus : pas de compte, compte non EMPLOYE, espace désactivé, rôle", async () => {
    const sans = await salarie("Fiche Réinit Sans");
    expect(await reinitialiserCompteEmploye(sans.id)).toEqual({ erreur: "Aucun compte salarié pour cet employé." });
    const stock = await salarie("Fiche Réinit Stock");
    const compteStock = await compteExistant(stock, { role: "STOCK", actif: true });
    expect(await reinitialiserCompteEmploye(stock.id)).toEqual({ erreur: "Aucun compte salarié pour cet employé." });

    const libre = await salarie("Fiche Réinit Libre");
    const compteLibre = await compteExistant(libre);
    await prisma.config.update({ where: { id: "singleton" }, data: { espaceEmployeActif: false } });
    expect(await reinitialiserCompteEmploye(libre.id)).toEqual({ erreur: "L'espace salarié n'est pas activé (Paramètres)." });
    await prisma.config.update({ where: { id: "singleton" }, data: { espaceEmployeActif: true } });
    A.user = { id: adminId, role: "MANAGER", nom: "Autre", employeeId: null };
    expect(await reinitialiserCompteEmploye(libre.id)).toEqual({ erreur: "Accès refusé : rôle insuffisant." });

    expect(AUTH.changementsMotDePasse).toBe(0);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: compteStock.id } })).toEqual(compteStock);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: compteLibre.id } })).toEqual(compteLibre);
  });
});

describe("nouvellesFichesEnLot (Paramètres → Espace salarié, « Nouvelle fiche »)", () => {
  it("un échec au MILIEU n'arrête pas le lot ; chaque salarié réinitialisé reçoit SA fiche, et elle seule", async () => {
    // Ordre de traitement = ordre alphabétique : « NF B » (panne) passe entre « NF A » et « NF C ».
    const a = await salarie("NF A Employe");
    const b = await salarie("NF B Panne");
    const c = await salarie("NF C Stock");
    const d = await salarie("NF D Email");
    const s = await salarie("NF E Sans Compte");
    const i = await salarie("NF F Inactif", { actif: false });
    const compteA = await compteExistant(a);
    const compteB = await compteExistant(b);
    const compteC = await compteExistant(c, { role: "STOCK", actif: true });
    const compteD = await compteExistant(d, { role: "STOCK", email: `nf.${d.matricule.toLowerCase()}@patesenfolie.cd`, actif: true });
    const compteI = await compteExistant(i);
    await prisma.employee.update({ where: { id: c.id }, data: { telephone: "+243 99 000 0003" } });
    AUTH.changementEnPanne.add(compteB.id);

    const { resultat: r, console: sortie } = await consoleDurant(() => nouvellesFichesEnLot([s.id, d.id, c.id, i.id, b.id, a.id]));
    if ("erreur" in r) throw new Error(r.erreur);

    expect(r.fiches.map(enClair)).toEqual([
      { employeeId: a.id, nom: "NF A Employe", matricule: a.matricule, telephone: null },
      { employeeId: c.id, nom: "NF C Stock", matricule: c.matricule, telephone: "+243 99 000 0003" },
    ]);
    expect(r.ignores).toEqual([
      { nom: "NF B Panne", raison: "échec de la réinitialisation : Échec de la mise à jour du mot de passe (500)." },
      { nom: "NF D Email", raison: "compte par adresse e-mail — géré dans Utilisateurs & accès" },
      { nom: "NF E Sans Compte", raison: "n'a pas de compte (utilisez « Créer les comptes »)" },
      { nom: "NF F Inactif", raison: "n'est plus actif" },
    ]);

    // Les fiches correspondent UNE À UNE aux salariés : jamais le mot de passe de l'un sur la fiche de l'autre.
    const mdpA = AUTH.motsDePasseParId.get(compteA.id)!;
    const mdpC = AUTH.motsDePasseParId.get(compteC.id)!;
    expect(mdpA).not.toBe(mdpC);
    const [ficheA, ficheC] = await Promise.all(r.fiches.map((f) => texteDuPdf(f.ficheBase64)));
    expect(await nombreDePages(r.fiches[0].ficheBase64)).toBe(1);
    expect(ficheA).toContain("NF A Employe");
    expect(ficheA).toContain(a.matricule);
    expect(ficheA).toContain(mdpA);
    expect(ficheA).not.toContain(mdpC);
    expect(ficheA).not.toContain(c.matricule);
    expect(ficheC).toContain("NF C Stock");
    expect(ficheC).toContain(c.matricule);
    expect(ficheC).toContain(mdpC);
    expect(ficheC).not.toContain(mdpA);
    expect(ficheC).not.toContain(a.matricule);
    // La planche d'impression porte les deux, et personne d'autre.
    const planche = await texteDuPdf(r.plancheBase64!);
    for (const attendu of [mdpA, mdpC]) expect(planche).toContain(attendu);
    for (const absent of [b.matricule, d.matricule, s.matricule, i.matricule]) expect(planche).not.toContain(absent);

    // La base, relue : A et C réinitialisés ; B, D, I intacts ; S toujours sans compte.
    expect(await prisma.user.findUniqueOrThrow({ where: { id: compteA.id } })).toMatchObject({ motDePasseTemporaire: true, actif: true });
    expect(await prisma.user.findUniqueOrThrow({ where: { id: compteC.id } })).toMatchObject({ role: "STOCK", motDePasseTemporaire: true });
    expect(await prisma.user.findUniqueOrThrow({ where: { id: compteB.id } })).toEqual(compteB);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: compteD.id } })).toEqual(compteD);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: compteI.id } })).toEqual(compteI);
    expect(await prisma.user.findUnique({ where: { employeeId: s.id } })).toBeNull();
    expect(AUTH.creations).toBe(0); // « Nouvelle fiche » ne crée jamais de compte

    // Les mots de passe ne sont écrits nulle part : ni en base, ni au journal, ni en console, ni en clair dans la réponse.
    const stocke = await toutLeTexteStocke();
    const reponseEnClair = JSON.stringify({ ...r, fiches: r.fiches.map(enClair), plancheBase64: null });
    for (const mdp of [mdpA, mdpC]) {
      expect(stocke).not.toContain(mdp);
      expect(sortie).not.toContain(mdp);
      expect(reponseEnClair).not.toContain(mdp);
    }
  }, 60_000);

  it("un compte MANAGER est nommé avec sa raison ; une réinitialisation à moitié faite dit la vérité", async () => {
    const m = await salarie("NF Manager");
    const compteM = await compteExistant(m, { role: "MANAGER", actif: true });
    const x = await salarie("NF Moitié");
    await compteExistant(x);
    H.client = clientEnPanne("journalAudit", "create");
    try {
      const r = await nouvellesFichesEnLot([m.id, x.id]);
      if ("erreur" in r) throw new Error(r.erreur);
      expect(r.fiches).toEqual([]);
      expect(r.ignores).toEqual([
        { nom: "NF Manager", raison: "ni compte salarié ni compte Stock — géré dans Utilisateurs & accès" },
        { nom: "NF Moitié", raison: "Mot de passe changé mais non enregistré : l'ancien ne marche plus, refaites “Nouvelle fiche” pour ce salarié." },
      ]);
    } finally {
      H.client = prisma;
    }
    expect(await prisma.user.findUniqueOrThrow({ where: { id: compteM.id } })).toEqual(compteM);
  });

  it("PDF impossible à produire : l'erreur dit que les anciens mots de passe ne fonctionnent plus", async () => {
    const a = await salarie("NF Sans Fiche");
    await compteExistant(a);
    const sans = await salarie("NF Sans Fiche Ni Compte");
    PDF.enPanne = true;
    expect(await nouvellesFichesEnLot([a.id, sans.id])).toEqual({
      erreur:
        "Les mots de passe de NF Sans Fiche ont été réinitialisés, mais les fiches n'ont pas pu être produites : " +
        "leurs anciens mots de passe ne fonctionnent plus. Relancez « Nouvelle fiche » pour eux. " +
        "Non réinitialisés : NF Sans Fiche Ni Compte (n'a pas de compte (utilisez « Créer les comptes »)).",
    });
  });

  it("refusé hors Direction, espace désactivé ou sélection vide : rien n'est réinitialisé", async () => {
    const a = await salarie("NF Garde");
    const compte = await compteExistant(a);
    for (const role of ["MANAGER", "VIEWER", "COMPTA", "STOCK", "EMPLOYE"]) {
      A.user = { id: adminId, role, nom: "Autre", employeeId: null };
      expect(await nouvellesFichesEnLot([a.id])).toEqual({ erreur: "Accès refusé : rôle insuffisant." });
    }
    A.user = { id: adminId, role: "ADMIN", nom: "Direction", employeeId: null };
    await prisma.config.update({ where: { id: "singleton" }, data: { espaceEmployeActif: false } });
    expect(await nouvellesFichesEnLot([a.id])).toEqual({ erreur: "L'espace salarié n'est pas activé (Paramètres)." });
    await prisma.config.update({ where: { id: "singleton" }, data: { espaceEmployeActif: true } });
    expect(await nouvellesFichesEnLot([])).toEqual({ erreur: "Cochez au moins un salarié." });
    expect(AUTH.changementsMotDePasse).toBe(0);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: compte.id } })).toEqual(compte);
  });
});

describe("l'écran des comptes en lot", () => {
  it("affiche l'avertissement sur les mots de passe (fiches individuelles, 2026-09-23)", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/app/(app)/parametres/comptes-lot.tsx"), "utf8");
    expect(source).toContain('"Chaque fiche contient un mot de passe : envoyez-la au seul salarié concerné, ou remettez-la-lui en main propre."');
    expect(source).toContain("{AVERTISSEMENT_FICHES}");
  });

  it("le mot de passe ne voyage que dans le fichier : aucun lien WhatsApp, aucun texte pré-rempli", () => {
    // Un lien « wa.me/?text=… » ou « whatsapp://send?text=… » mettrait le mot de passe dans une URL
    // (historique, journaux du serveur de WhatsApp, aperçu du lien). L'écran partage le PDF seul.
    for (const f of ["src/app/(app)/parametres/comptes-lot.tsx", "src/app/(app)/parametres/comptes-lot-actions.ts"]) {
      const source = fs.readFileSync(path.join(process.cwd(), f), "utf8").replace(/^\s*\/\/.*$/gm, ""); // hors commentaires
      expect(source, f).not.toMatch(/wa\.me|api\.whatsapp|whatsapp:\/\/|[?&]text=/i);
      expect(source, f).not.toMatch(/share\(\s*\{[^}]*\b(text|url)\s*:/); // un partage ne porte que `files`
    }
  });
});

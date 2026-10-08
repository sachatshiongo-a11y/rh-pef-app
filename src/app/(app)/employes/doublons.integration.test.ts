import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { renderToStaticMarkup } from "react-dom/server";
import { creerBaseTest } from "@/lib/test/db";

// ANTI-DOUBLON DES FICHES EMPLOYÉS — preuve par les VRAIES actions serveur appelées directement,
// comme le ferait un envoi qui contourne l'écran : le serveur revérifie, refuse lisiblement sans le
// choix explicite, accepte avec lui (et le journalise) ; une modification ne repose la question que
// si l'identité change. Puis l'encadré des doublons existants : Direction seulement.

const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
const A = vi.hoisted(() => ({ user: { id: "", email: "d@pef.cd", nom: "Direction", role: "ADMIN" as string, accesStock: false, employeeId: null as string | null } }));

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
  requireRole: (u: { role: string }, roles: string[]) => { if (!roles.includes(u.role)) throw new Error("Accès refusé : rôle insuffisant."); },
}));
vi.mock("@/lib/garde-page", () => ({ exigerPageRH: async () => A.user }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw Object.assign(new Error(`REDIRECT ${url}`), { digest: `NEXT_REDIRECT;${url}`, url }); },
  notFound: () => { throw Object.assign(new Error("NOT_FOUND"), { digest: "NEXT_NOT_FOUND" }); },
}));

const RH = await import("./actions");

let prisma: PrismaClient;
let fermer: () => Promise<void>;

/** Exécute une action de formulaire ; renvoie l'URL de redirection (succès ou `?erreur=`). */
async function envoyer(f: () => Promise<unknown>): Promise<string> {
  try {
    await f();
  } catch (e) {
    const url = (e as { url?: string }).url;
    if (url) return url;
    throw e;
  }
  return "";
}
const erreurDe = (url: string) => decodeURIComponent(url.split("erreur=")[1] ?? "");

function formulaire(champs: Record<string, string>): FormData {
  const fd = new FormData();
  const base: Record<string, string> = {
    matricule: "", sexe: "M", etatCivil: "Célibataire", poste: "Cuisinier", secteur: "Cuisine", categorie: "BRIGADE",
    categorieProfessionnelle: "", salaireMensuel: "300", heuresHebdomadaires: "48", heuresParJour: "8", transportJourCDF: "",
    transportMoisCDF: "", transportMoisUSD: "", cnssMontant: "", fraisMedicauxMoisCourant: "0", enfants: "0", type: "NATIONAL",
    contrat: "CDD", dateEmbauche: "2026-10-01", dateNaissance: "", telephone: "", email: "", adresse: "", banque: "",
    compteBancaire: "", mobileMoney: "", modePaiement: "ESPECES", idExterneIVMS: "",
  };
  for (const [k, v] of Object.entries({ ...base, ...champs })) fd.set(k, v);
  return fd;
}

async function employe(nom: string, extra: Record<string, unknown> = {}) {
  return prisma.employee.create({
    data: {
      matricule: `M${Math.random().toString(36).slice(2, 8)}`, nom, sexe: "M", etatCivil: "Célibataire", poste: "Cuisinier", secteur: "Cuisine",
      categorie: "BRIGADE", salaireMensuel: 300, dateEmbauche: new Date("2024-01-01T00:00:00Z"), contrat: "CDD", ...extra,
    },
  });
}

beforeAll(async () => {
  ({ prisma, fermer } = await creerBaseTest());
  H.client = prisma;
  const u = await prisma.user.create({ data: { email: "d@pef.cd", nom: "Direction", role: "ADMIN" } });
  A.user.id = u.id;
});
afterAll(async () => { await fermer?.(); });
beforeEach(async () => {
  A.user.role = "ADMIN";
  await prisma.journalAudit.deleteMany();
  await prisma.employee.deleteMany();
});

describe("création : le serveur revérifie les fiches proches", () => {
  it("refuse sans choix une fiche proche INACTIVE (ordre des mots inversé) — rien n'est créé, le refus nomme la fiche", async () => {
    const ancienne = await employe("Sacha Tshiongo", { actif: false });
    const url = await envoyer(() => RH.creerEmploye(formulaire({ nom: "Tshiongo Sacha" })));
    expect(url).toMatch(/^\/employes\/nouveau\?erreur=/);
    expect(erreurDe(url)).toContain("« Sacha Tshiongo » (inactive) — même nom");
    expect(await prisma.employee.count()).toBe(1);
    expect(ancienne.actif).toBe(false);
  });

  it("refuse sur le même téléphone, même avec un nom sans rapport", async () => {
    await employe("Jean Kabila", { telephone: "+243 99 111 2233" });
    const url = await envoyer(() => RH.creerEmploye(formulaire({ nom: "Papa Jean", telephone: "0991112233" })));
    expect(erreurDe(url)).toContain("même téléphone");
    expect(await prisma.employee.count()).toBe(1);
  });

  it("accepte avec « C'est une autre personne » (id de la fiche proche) et journalise la décision", async () => {
    const ancienne = await employe("Sacha Tshiongo");
    const url = await envoyer(() => RH.creerEmploye(formulaire({ nom: "Tshiongo Sacha", doublonsEcartes: ancienne.id })));
    expect(url).toBe("/employes");
    const nouvelle = await prisma.employee.findFirstOrThrow({ where: { NOT: { id: ancienne.id } } });
    const journal = await prisma.journalAudit.findMany({ where: { champ: "doublon-ecarte" } });
    expect(journal).toEqual([expect.objectContaining({ entite: "Employee", entiteId: nouvelle.id, nouvelleValeur: ancienne.id })]);
  });

  it("un choix qui ne couvre pas TOUTES les fiches proches est refusé (fiche apparue après l'affichage)", async () => {
    const a = await employe("Sacha Tshiongo");
    await employe("Tshiongo", { actif: false });
    const url = await envoyer(() => RH.creerEmploye(formulaire({ nom: "Sacha Tshiongo", doublonsEcartes: a.id })));
    expect(erreurDe(url)).toContain("« Tshiongo » (inactive)");
    expect(erreurDe(url)).not.toContain("« Sacha Tshiongo »");
    expect(await prisma.employee.count()).toBe(2);
  });

  it("aucune fiche proche : créée sans rien demander, rien au journal", async () => {
    await employe("Sacha Mukendi");
    expect(await envoyer(() => RH.creerEmploye(formulaire({ nom: "Sacha Tshiongo" })))).toBe("/employes");
    expect(await prisma.employee.count()).toBe(2);
    expect(await prisma.journalAudit.count({ where: { champ: "doublon-ecarte" } })).toBe(0);
  });
});

describe("modification : la question ne se repose que si l'identité change", () => {
  it("salaire modifié sur une fiche qui a un homonyme proche : enregistré sans choix", async () => {
    const a = await employe("Sacha Tshiongo");
    await employe("Tshiongo Sacha", { actif: false });
    const url = await envoyer(() => RH.modifierEmploye(a.id, formulaire({ nom: "Sacha Tshiongo", salaireMensuel: "450" })));
    expect(url).toBe("/employes");
    expect(Number((await prisma.employee.findUniqueOrThrow({ where: { id: a.id } })).salaireMensuel)).toBe(450);
  });

  it("nom changé vers une fiche proche : refusé sans choix, accepté avec, et la fiche elle-même n'est jamais son propre doublon", async () => {
    const a = await employe("Esther Nsundi");
    const b = await employe("Martine Mutombo", { actif: false });
    const refus = await envoyer(() => RH.modifierEmploye(a.id, formulaire({ nom: "Mutombo Martine" })));
    expect(refus).toMatch(new RegExp(`^/employes/${a.id}/modifier\\?erreur=`));
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: a.id } })).nom).toBe("Esther Nsundi");
    expect(await envoyer(() => RH.modifierEmploye(a.id, formulaire({ nom: "Mutombo Martine", doublonsEcartes: b.id })))).toBe("/employes");
    // La paire est écartée : renommer encore (identité modifiée) ne la repose plus.
    expect(await envoyer(() => RH.modifierEmploye(a.id, formulaire({ nom: "Martine Mutombo" })))).toBe("/employes");
  });
});

describe("encadré des doublons probables (liste des employés)", () => {
  const page = async () => {
    const { default: EmployesPage } = await import("./page");
    return renderToStaticMarkup(await EmployesPage({ searchParams: Promise.resolve({}) }));
  };

  it("Direction : la paire (active / inactive) est listée avec un lien vers chaque fiche", async () => {
    const a = await employe("Sacha Tshiongo");
    const b = await employe("Tshiongo Sacha", { actif: false });
    const html = await page();
    expect(html).toContain("2 fiches semblent en double");
    expect(html).toContain(`href="/employes/${a.id}"`);
    expect(html).toContain(`href="/employes/${b.id}"`);
    expect(html).toContain("la fusion de deux dossiers n&#x27;existe pas");
  });

  it("Responsable RH (MANAGER) : aucun encadré, même avec des doublons", async () => {
    await employe("Sacha Tshiongo");
    await employe("Tshiongo Sacha");
    A.user.role = "MANAGER";
    expect(await page()).not.toContain("semblent en double");
  });

  it("« Deux personnes différentes » : Direction seulement, la paire ne s'affiche plus", async () => {
    const a = await employe("Sacha Tshiongo");
    const b = await employe("Tshiongo Sacha");
    A.user.role = "MANAGER";
    await expect(RH.ecarterDoublon(a.id, b.id)).rejects.toThrow(/rôle insuffisant/);
    A.user.role = "ADMIN";
    await RH.ecarterDoublon(b.id, a.id);
    expect(await page()).not.toContain("semblent en double");
  });
});

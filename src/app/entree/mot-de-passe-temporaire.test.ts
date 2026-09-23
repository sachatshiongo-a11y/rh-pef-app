import { describe, it, expect, beforeEach, vi } from "vitest";

// Le mot de passe temporaire d'une fiche de connexion est « à changer à la première connexion ».
// « Nouvelle fiche » (Paramètres → Espace salarié) en donne aussi à un compte STOCK relié à une
// fiche employé (identifiant matricule — cas d'Aimée) : l'entrée doit l'envoyer changer son mot de
// passe, et le changement doit lui être permis — sinon la garde de l'espace salarié le renvoie sur
// une page dont le formulaire répond « Accès refusé », sans issue. Sans base : tout est simulé.

type U = { id: string; email: string; nom: string; role: string; accesStock: boolean; employeeId: string | null };
const S = vi.hoisted(() => ({
  user: null as unknown as U,
  espaceActif: true,
  temporaire: true,
  miseAJour: [] as unknown[],
  motsDePasse: [] as string[],
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error(`REDIRECT ${url}`), { digest: `NEXT_REDIRECT;replace;${url};307;` });
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth", async (original) => ({
  ...(await original<typeof import("@/lib/auth")>()),
  verifySession: async () => S.user,
}));
vi.mock("@/lib/espace-employe", async (original) => ({
  ...(await original<typeof import("@/lib/espace-employe")>()),
  espaceEmployeActif: async () => S.espaceActif,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: async () => ({ motDePasseTemporaire: S.temporaire }),
      update: async (a: unknown) => void S.miseAJour.push(a),
    },
  },
}));
vi.mock("@/lib/securite-connexion", () => ({
  changerMotDePasseAdmin: async (_id: string, mdp: string) => void S.motsDePasse.push(mdp),
}));

const { default: EntreePage } = await import("./page");
const { changerMonMotDePasse } = await import("@/app/espace/actions");

async function destination(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (e) {
    const m = String((e as Error).message).match(/^REDIRECT (.*)$/);
    if (m) return decodeURIComponent(m[1]);
    throw e;
  }
  throw new Error("aucune redirection");
}

const compte = (role: string, employeeId: string | null, accesStock = false): U => ({
  id: "u1", email: "x@salarie.local", nom: "X", role, accesStock, employeeId,
});

function formulaire(mdp: string) {
  const fd = new FormData();
  fd.set("motDePasse", mdp);
  fd.set("confirmation", mdp);
  return fd;
}

beforeEach(() => {
  S.espaceActif = true;
  S.temporaire = true;
  S.miseAJour = [];
  S.motsDePasse = [];
});

describe("entrée : le mot de passe temporaire se change d'abord", () => {
  it("compte STOCK relié à une fiche (Aimée), mot de passe temporaire : envoyé le changer", async () => {
    S.user = compte("STOCK", "emp-aimee");
    expect(await destination(EntreePage)).toBe("/espace/mot-de-passe");
  });

  it("compte STOCK relié, mot de passe déjà personnel : entre normalement", async () => {
    S.user = compte("STOCK", "emp-aimee");
    S.temporaire = false;
    expect(await destination(EntreePage)).toBe("/choix-espace"); // salarié + stock
  });

  it("espace salarié fermé : un compte STOCK n'est PAS envoyé vers une page qui le renverrait ici", async () => {
    S.user = compte("STOCK", "emp-aimee");
    S.espaceActif = false;
    expect(await destination(EntreePage)).toBe("/stock");
  });

  it("compte STOCK sans fiche liée : jamais concerné", async () => {
    S.user = compte("STOCK", null);
    expect(await destination(EntreePage)).toBe("/stock");
  });

  it("compte EMPLOYE : inchangé", async () => {
    S.user = compte("EMPLOYE", "emp-1");
    expect(await destination(EntreePage)).toBe("/espace/mot-de-passe");
    S.temporaire = false;
    expect(await destination(EntreePage)).toBe("/espace");
  });
});

describe("changerMonMotDePasse", () => {
  it("un compte STOCK relié à une fiche peut remplacer son mot de passe temporaire", async () => {
    S.user = compte("STOCK", "emp-aimee");
    expect(await destination(() => changerMonMotDePasse(formulaire("nouveau-secret")))).toBe("/entree");
    expect(S.motsDePasse).toEqual(["nouveau-secret"]);
    expect(S.miseAJour).toEqual([{ where: { id: "u1" }, data: { motDePasseTemporaire: false } }]);
  });

  it("un compte EMPLOYE : inchangé, retour à son espace", async () => {
    S.user = compte("EMPLOYE", "emp-1");
    expect(await destination(() => changerMonMotDePasse(formulaire("nouveau-secret")))).toBe("/espace");
  });

  it("un compte sans fiche liée (hors EMPLOYE) : refusé, rien n'est changé", async () => {
    S.user = compte("ADMIN", null);
    expect(await destination(() => changerMonMotDePasse(formulaire("nouveau-secret")))).toBe(
      "/espace/mot-de-passe?erreur=Accès refusé.",
    );
    expect(S.motsDePasse).toEqual([]);
    expect(S.miseAJour).toEqual([]);
  });
});

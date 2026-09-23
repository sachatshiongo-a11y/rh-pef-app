import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

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
    bonDeCommande: { count: async () => 0 },
    $queryRaw: async () => [],
  },
}));
vi.mock("@/lib/securite-connexion", () => ({
  changerMotDePasseAdmin: async (_id: string, mdp: string) => void S.motsDePasse.push(mdp),
}));
vi.mock("@/app/login/actions", () => ({ logout: async () => {} }));
vi.mock("@/lib/notifications", () => ({ chargerNotifications: async () => ({ items: [], nonLues: 0 }) }));
vi.mock("@/app/(stock)/stock-shell", () => ({ StockShell: () => null }));

const { default: EntreePage } = await import("./page");
const { changerMonMotDePasse } = await import("@/app/espace/actions");
const { default: MotDePassePage } = await import("@/app/espace/mot-de-passe/page");
const { default: StockLayout } = await import("@/app/(stock)/layout");

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

  it("compte EMPLOYE à mot de passe temporaire, espace fermé : un message, plus de boucle", async () => {
    // Avant : /entree → /espace/mot-de-passe → /entree… (et, sans espace, /login → /entree…).
    S.user = compte("EMPLOYE", "emp-1");
    S.espaceActif = false;
    const html = renderToStaticMarkup((await EntreePage()) as React.ReactElement);
    expect(html).toContain("L&#x27;espace salarié est fermé");
    expect(html).toContain("Déconnexion");
  });
});

describe("page /espace/mot-de-passe : même règle que l'action", () => {
  const page = () => MotDePassePage({ searchParams: Promise.resolve({}) });

  it("ADMIN relié à une fiche, mot de passe personnel : pas de formulaire", async () => {
    S.user = compte("ADMIN", "emp-sacha");
    S.temporaire = false;
    expect(await destination(page)).toBe("/entree");
  });

  it("STOCK relié, temporaire, espace fermé : pas de formulaire", async () => {
    S.user = compte("STOCK", "emp-aimee");
    S.espaceActif = false;
    expect(await destination(page)).toBe("/entree");
  });

  it("STOCK relié, temporaire, espace ouvert : le formulaire s'affiche", async () => {
    S.user = compte("STOCK", "emp-aimee");
    expect(renderToStaticMarkup((await page()) as React.ReactElement)).toContain('name="motDePasse"');
  });
});

describe("espace Stock : le mot de passe temporaire se change d'abord", () => {
  const layout = () => StockLayout({ children: null });

  it("compte STOCK relié, temporaire, espace ouvert : envoyé le changer", async () => {
    S.user = compte("STOCK", "emp-aimee");
    expect(await destination(layout)).toBe("/espace/mot-de-passe");
  });

  it("espace fermé : il entre (la page de changement le refuserait : pas de boucle)", async () => {
    S.user = compte("STOCK", "emp-aimee");
    S.espaceActif = false;
    await expect(layout()).resolves.toBeTruthy();
  });

  it("mot de passe personnel, ou compte sans fiche : il entre", async () => {
    S.user = compte("STOCK", "emp-aimee");
    S.temporaire = false;
    await expect(layout()).resolves.toBeTruthy();
    S.user = compte("STOCK", null);
    S.temporaire = true;
    await expect(layout()).resolves.toBeTruthy();
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

  // Le formulaire ne demande pas l'ancien mot de passe et n'écrit rien au journal : hors EMPLOYE,
  // il ne sert qu'au mot de passe TEMPORAIRE d'une fiche (Sacha, Esther : refusés).
  it("ADMIN relié à une fiche, mot de passe non temporaire : refusé, rien n'est changé", async () => {
    S.user = compte("ADMIN", "emp-sacha");
    S.temporaire = false;
    expect(await destination(() => changerMonMotDePasse(formulaire("nouveau-secret")))).toBe(
      "/espace/mot-de-passe?erreur=Accès refusé.",
    );
    expect(S.motsDePasse).toEqual([]);
    expect(S.miseAJour).toEqual([]);
  });

  it("STOCK relié, temporaire, espace ouvert : accepté", async () => {
    S.user = compte("STOCK", "emp-esther");
    expect(await destination(() => changerMonMotDePasse(formulaire("nouveau-secret")))).toBe("/entree");
    expect(S.motsDePasse).toEqual(["nouveau-secret"]);
  });

  it("STOCK relié, temporaire, espace fermé : refusé, rien n'est changé", async () => {
    S.user = compte("STOCK", "emp-esther");
    S.espaceActif = false;
    expect(await destination(() => changerMonMotDePasse(formulaire("nouveau-secret")))).toBe(
      "/espace/mot-de-passe?erreur=Accès refusé.",
    );
    expect(S.motsDePasse).toEqual([]);
    expect(S.miseAJour).toEqual([]);
  });
});

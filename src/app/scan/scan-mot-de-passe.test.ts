import { describe, it, expect, beforeEach, vi } from "vitest";
import { createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// ─────────────────────────────────────────────────────────────────────────────
// LE SCAN SURVIT AU CHANGEMENT DU MOT DE PASSE TEMPORAIRE.
//
// Le salarié scanne l'affiche avec l'appareil photo : `/scan?c=X`. Sans session, le garde
// d'authentification l'envoie vers `/login?retour=/scan?c=X` ; la connexion le ramène au scan.
// Si son mot de passe est encore TEMPORAIRE, `/scan` l'envoyait vers `/espace/mot-de-passe` en
// oubliant le code : après le changement, il atterrissait dans son espace et devait rescanner.
// Le retour l'accompagne désormais d'un bout à l'autre, et seul le scan est un retour permis.
// Sans base : tout est simulé.
// ─────────────────────────────────────────────────────────────────────────────

type U = { id: string; email: string; nom: string; role: string; accesStock: boolean; employeeId: string | null };
const S = vi.hoisted(() => ({
  user: null as unknown as U,
  espaceActif: true,
  temporaire: true,
  miseAJour: [] as unknown[],
  journal: [] as unknown[],
  motsDePasse: [] as string[],
  scans: [] as unknown[],
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error(`REDIRECT ${url}`), { digest: `NEXT_REDIRECT;replace;${url};307;` });
  },
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/image", () => ({ default: (p: { alt: string }) => createElement("img", { alt: p.alt }) }));
vi.mock("next/link", () => ({
  default: (p: { href: string; children: ReactNode }) => createElement("a", { href: p.href }, p.children),
}));
vi.mock("@/lib/auth", async (original) => ({
  ...(await original<typeof import("@/lib/auth")>()),
  verifySession: async () => S.user,
}));
vi.mock("@/lib/espace-employe", async (original) => ({
  ...(await original<typeof import("@/lib/espace-employe")>()),
  espaceEmployeActif: async () => S.espaceActif,
}));
vi.mock("@/lib/prisma", () => {
  const prisma = {
    user: {
      findUnique: async () => ({
        motDePasseTemporaire: S.temporaire,
        employeeId: S.user.employeeId,
        role: S.user.role,
        actif: true,
      }),
      update: async (a: { data: { motDePasseTemporaire?: boolean } }) => {
        S.miseAJour.push(a);
        if (a.data.motDePasseTemporaire === false) S.temporaire = false;
      },
    },
    journalAudit: { createMany: async (a: { data: unknown[] }) => void S.journal.push(...a.data) },
    $transaction: async (f: (tx: unknown) => Promise<unknown>) => f(prisma),
  };
  return { prisma };
});
vi.mock("@/lib/securite-connexion", () => ({
  minutesBlocage: async () => 0,
  enregistrerEchec: async () => {},
  effacerEchecs: async () => {},
  genererJetonReinitialisation: async () => "",
  verifierJeton: async () => null,
  consommerJeton: async () => {},
  changerMotDePasseAdmin: async (_id: string, mdp: string) => void S.motsDePasse.push(mdp),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      signInWithPassword: async () => ({ data: { user: { id: S.user.id } }, error: null }),
      signOut: async () => {},
    },
  }),
}));
vi.mock("@/lib/email", () => ({ envoyerEmail: async () => {} }));
// L'action serveur du scan : un espion. Tout appel = un scan enregistré.
vi.mock("@/app/pointage/actions", () => ({
  scannerAffiche: async (e: unknown) => {
    S.scans.push(e);
    return { ok: true, data: { etat: "COMPLETE" } };
  },
  confirmerDepart: async () => ({ ok: true, data: {} }),
}));

const { default: ScanPage } = await import("./page");
const { default: MotDePassePage } = await import("@/app/espace/mot-de-passe/page");
const { changerMonMotDePasse } = await import("@/app/espace/actions");
const { login } = await import("@/app/login/actions");
const { LoginForm } = await import("@/app/login/login-form");

/** L'adresse d'une redirection, telle quelle (non décodée). */
async function destination(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (e) {
    const m = String((e as Error).message).match(/^REDIRECT (.*)$/);
    if (m) return m[1];
    throw e;
  }
  throw new Error("aucune redirection");
}

const rendu = async (fn: () => Promise<unknown>) => renderToStaticMarkup((await fn()) as ReactElement);
const scan = (c?: string) => () => ScanPage({ searchParams: Promise.resolve(c === undefined ? {} : { c }) });
const pageMdp = (sp: { retour?: string; erreur?: string }) => () => MotDePassePage({ searchParams: Promise.resolve(sp) });

function formulaire(mdp: string, retour?: string, confirmation = mdp) {
  const fd = new FormData();
  fd.set("motDePasse", mdp);
  fd.set("confirmation", confirmation);
  if (retour !== undefined) fd.set("retour", retour);
  return fd;
}

function connexion(retour: string) {
  const fd = new FormData();
  fd.set("email", "salarie@exemple.cd");
  fd.set("password", "temporaire");
  fd.set("retour", retour);
  return fd;
}

const compte = (role: string, employeeId: string | null): U => ({
  id: "u1", email: "x@salarie.local", nom: "X", role, accesStock: false, employeeId,
});

const HOSTILES = ["//evil.com", "https://evil.com", "/\\evil", "javascript:alert(1)"];

beforeEach(() => {
  S.user = compte("EMPLOYE", "emp-1");
  S.espaceActif = true;
  S.temporaire = true;
  S.miseAJour = [];
  S.journal = [];
  S.motsDePasse = [];
  S.scans = [];
});

describe("chaîne complète : connexion → mot de passe temporaire → retour au scan", () => {
  it("le code de l'affiche survit à toute la chaîne", async () => {
    // 1. Connexion depuis l'affiche : retour au scan.
    expect(await destination(() => login(undefined, connexion("/scan?c=X")))).toBe("/scan?c=X");

    // 2. Le scan voit le mot de passe temporaire : il envoie le changer, SANS perdre le code.
    const versMdp = await destination(scan("X"));
    expect(versMdp).toBe("/espace/mot-de-passe?retour=%2Fscan%3Fc%3DX");
    const retour = new URL(versMdp, "http://h").searchParams.get("retour")!;
    expect(retour).toBe("/scan?c=X");

    // 3. La page de changement garde le retour dans le formulaire.
    const html = await rendu(pageMdp({ retour }));
    expect(html).toContain('name="retour" value="/scan?c=X"');

    // 4. Le changement réussi ramène au scan.
    expect(await destination(() => changerMonMotDePasse(formulaire("nouveau-secret", retour)))).toBe("/scan?c=X");
    expect(S.motsDePasse).toEqual(["nouveau-secret"]);

    // 5. Le scan s'affiche avec le code — et le rendu serveur n'a rien pointé.
    const ecran = await rendu(scan("X"));
    expect(ecran).toContain("Pointer");
    expect(S.scans).toEqual([]);
  });

  it("un compte STOCK relié à une fiche suit la même chaîne", async () => {
    S.user = compte("STOCK", "emp-aimee");
    expect(await destination(scan("X"))).toBe("/espace/mot-de-passe?retour=%2Fscan%3Fc%3DX");
    expect(await destination(() => changerMonMotDePasse(formulaire("nouveau-secret", "/scan?c=X")))).toBe("/scan?c=X");
  });

  it("un code encodé (a+b) revient tel que l'affiche l'imprime", async () => {
    const versMdp = await destination(scan("a+b"));
    const retour = new URL(versMdp, "http://h").searchParams.get("retour")!;
    expect(retour).toBe("/scan?c=a%2Bb");
    expect(await destination(() => changerMonMotDePasse(formulaire("nouveau-secret", retour)))).toBe("/scan?c=a%2Bb");
  });

  it("une erreur de saisie garde le retour (sinon le scan se perdrait au second essai)", async () => {
    const dest = await destination(() => changerMonMotDePasse(formulaire("nouveau-secret", "/scan?c=X", "autre-chose")));
    const u = new URL(dest, "http://h");
    expect(u.pathname).toBe("/espace/mot-de-passe");
    expect(u.searchParams.get("retour")).toBe("/scan?c=X");
    expect(u.searchParams.get("erreur")).toBe("Les deux mots de passe ne correspondent pas.");
    expect(S.motsDePasse).toEqual([]);
    const html = await rendu(pageMdp({ retour: "/scan?c=X", erreur: "Les deux mots de passe ne correspondent pas." }));
    expect(html).toContain('name="retour" value="/scan?c=X"');
  });

  it("scan sans code, mot de passe temporaire : la page de changement nue", async () => {
    expect(await destination(scan())).toBe("/espace/mot-de-passe");
  });
});

describe("pas de boucle de redirection", () => {
  it("mot de passe déjà personnel : /scan ne renvoie nulle part", async () => {
    S.temporaire = false;
    await expect(rendu(scan("X"))).resolves.toContain("Pointer");
  });

  it("page de changement avec retour, mot de passe déjà personnel : retour au scan (onglet resté ouvert)", async () => {
    S.temporaire = false;
    expect(await destination(pageMdp({ retour: "/scan?c=X" }))).toBe("/scan?c=X");
  });

  it("page de changement, espace fermé : /entree, jamais le scan (qui ne renverrait pas ici)", async () => {
    S.espaceActif = false;
    S.user = compte("STOCK", "emp-aimee");
    expect(await destination(pageMdp({ retour: "/scan?c=X" }))).toBe("/entree");
  });
});

describe("retour hostile : refusé partout, remplacé par la destination habituelle", () => {
  it.each(HOSTILES)("action de changement, retour %s → /entree (compte STOCK), /espace (EMPLOYE)", async (r) => {
    S.user = compte("STOCK", "emp-aimee");
    expect(await destination(() => changerMonMotDePasse(formulaire("nouveau-secret", r)))).toBe("/entree");
    S.user = compte("EMPLOYE", "emp-1");
    S.temporaire = true;
    expect(await destination(() => changerMonMotDePasse(formulaire("nouveau-secret", r)))).toBe("/espace");
  });

  it.each(HOSTILES)("page de changement, retour %s : aucun champ retour, aucune redirection vers lui", async (r) => {
    const html = await rendu(pageMdp({ retour: r }));
    expect(html).not.toContain('name="retour"');
    S.temporaire = false; // mot de passe personnel : un retour hostile n'est pas suivi
    const html2 = await rendu(pageMdp({ retour: r }));
    expect(html2).toContain('name="motDePasse"');
  });

  it.each(HOSTILES)("erreur de saisie avec retour %s : la page d'erreur ne l'emporte pas", async (r) => {
    const dest = await destination(() => changerMonMotDePasse(formulaire("court", r)));
    expect(new URL(dest, "http://h").searchParams.get("retour")).toBeNull();
  });

  it.each(HOSTILES)("connexion, retour %s → /entree", async (r) => {
    expect(await destination(() => login(undefined, connexion(r)))).toBe("/entree");
  });
});

describe("espace salarié fermé : un message clair, sans redirection", () => {
  it("compte STOCK relié, mot de passe temporaire : le scan ne part pas vers une page qui le perdrait", async () => {
    S.user = compte("STOCK", "emp-aimee");
    S.espaceActif = false;
    const html = await rendu(scan("X"));
    expect(html).toContain("mot de passe temporaire");
    expect(html).toContain("espace salarié est fermé");
    expect(html).not.toContain("Pointer maintenant");
    expect(S.scans).toEqual([]);
  });

  it("compte EMPLOYE (session antérieure à la fermeture) : même message", async () => {
    S.espaceActif = false;
    const html = await rendu(scan("X"));
    expect(html).toContain("espace salarié est fermé");
  });

  it("compte sans fiche liée : le message habituel, pas celui du mot de passe", async () => {
    S.user = compte("STOCK", null);
    const html = await rendu(scan("X"));
    expect(html).toContain("pas encore lié à une fiche");
  });
});

describe("journal du changement de mot de passe", () => {
  it("le changement est journalisé — qui, quoi — jamais le mot de passe", async () => {
    await destination(() => changerMonMotDePasse(formulaire("nouveau-secret", "/scan?c=X")));
    expect(S.journal).toEqual([
      {
        entite: "User",
        entiteId: "u1",
        champ: "motDePasse",
        ancienneValeur: "temporaire",
        nouvelleValeur: "personnel (changé par le salarié)",
        userId: "u1",
      },
    ]);
    expect(JSON.stringify(S.journal)).not.toContain("nouveau-secret");
    expect(S.miseAJour).toEqual([{ where: { id: "u1" }, data: { motDePasseTemporaire: false } }]);
  });

  it("un EMPLOYE qui change un mot de passe déjà personnel : journalisé aussi", async () => {
    S.temporaire = false;
    await destination(() => changerMonMotDePasse(formulaire("nouveau-secret")));
    expect(S.journal).toHaveLength(1);
    expect(S.journal[0]).toMatchObject({ ancienneValeur: "personnel" });
  });

  it("refus ou erreur de saisie : rien au journal", async () => {
    await destination(() => changerMonMotDePasse(formulaire("court")));
    S.user = compte("ADMIN", null);
    await destination(() => changerMonMotDePasse(formulaire("nouveau-secret")));
    expect(S.journal).toEqual([]);
    expect(S.motsDePasse).toEqual([]);
  });
});

describe("connexion depuis un scan : pré-remplie par le téléphone, gros bouton", () => {
  const formulaireConnexion = (retour: string | null) => renderToStaticMarkup(createElement(LoginForm, { retour }));

  it("identifiant et mot de passe annoncés au gestionnaire de mots de passe", () => {
    const html = formulaireConnexion("/scan?c=X");
    expect(html).toMatch(/name="email"[^>]*autoComplete="username"|autoComplete="username"[^>]*name="email"/i);
    expect(html).toMatch(/autoComplete="current-password"/i);
    expect(html).toContain('name="retour" value="/scan?c=X"');
  });

  it("champs en 16 px et bouton pleine largeur quand on vient d'un scan", () => {
    const html = formulaireConnexion("/scan?c=X");
    expect(html).toContain("min-h-12 w-full py-3 text-base");
    expect(html).toContain("Votre matricule");
    expect(html).not.toMatch(/sm:text-sm/);
  });

  it("connexion ordinaire (Direction, bureau) : inchangée", () => {
    const html = formulaireConnexion(null);
    expect(html).not.toContain("min-h-12");
    expect(html).not.toContain('name="retour"');
  });
});

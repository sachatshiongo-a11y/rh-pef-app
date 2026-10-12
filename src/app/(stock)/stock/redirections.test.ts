// REDIRECTIONS DU LOT 5 (plan d'ergonomie, annexe B) : les écrans déplacés gardent leur ancienne adresse,
// qui renvoie vers le nouvel endroit — favoris, liens écrits dans des messages, notifications déjà envoyées.
//   /stock/utilisateurs                 → /parametres#utilisateurs         (rubrique de Paramètres)
//   /stock/archives  (et ?vue=comptages) → /stock/reconciliation?vue=comptages (onglet « Comptages passés »)
//   /stock/archives?vue=bons             → /stock/commandes?statut=VALIDE      (filtre d'état « Validés »)
// Éprouvé sur les VRAIES pages : la redirection est levée par Next (`redirect`), son code (307) et sa cible
// sont lus dans l'erreur levée. La garde Stock reste la 1re instruction (un compte hors Stock ne passe pas).
import { describe, it, expect, vi, beforeEach } from "vitest";

const G = vi.hoisted(() => ({ garde: vi.fn(async () => ({ id: "u", role: "STOCK" })) }));
vi.mock("@/lib/garde-page", () => ({ exigerPageStock: G.garde }));
vi.mock("@/lib/prisma", () => ({ prisma: {} })); // jamais lu : la redirection part avant toute requête

beforeEach(() => G.garde.mockClear());

/** Exécute la page et lit la redirection qu'elle lève : { statut, cible }. */
async function redirection(page: () => Promise<unknown>): Promise<{ statut: number; cible: string } | null> {
  try {
    await page();
  } catch (e) {
    const digest = (e as { digest?: string }).digest ?? "";
    const [marque, , cible, statut] = digest.split(";");
    if (marque === "NEXT_REDIRECT") return { statut: Number(statut), cible };
    throw e;
  }
  return null;
}
const archives = async (sp: Record<string, string>) => {
  const { default: Page } = await import("./archives/page");
  return redirection(() => Page({ searchParams: Promise.resolve(sp) }));
};

describe("/stock/utilisateurs", () => {
  it("renvoie vers la rubrique Utilisateurs de Paramètres, en redirection temporaire", async () => {
    const { default: Page } = await import("./utilisateurs/page");
    expect(await redirection(() => Page())).toEqual({ statut: 307, cible: "/parametres#utilisateurs" });
  });

  it("garde la garde Stock : un compte refusé est renvoyé avant toute redirection", async () => {
    G.garde.mockRejectedValueOnce(Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/entree;307;" }));
    const { default: Page } = await import("./utilisateurs/page");
    expect(await redirection(() => Page())).toEqual({ statut: 307, cible: "/entree" });
    expect(G.garde).toHaveBeenCalledTimes(1);
  });
});

describe("/stock/archives", () => {
  it("?vue=comptages → Réconciliation, onglet Comptages passés (307)", async () => {
    expect(await archives({ vue: "comptages" })).toEqual({ statut: 307, cible: "/stock/reconciliation?vue=comptages" });
  });

  it("sans vue (l'ancienne vue par défaut était les comptages) → la même cible", async () => {
    expect(await archives({})).toEqual({ statut: 307, cible: "/stock/reconciliation?vue=comptages" });
  });

  it("une vue inconnue ne reste pas sur une page vide : mêmes comptages", async () => {
    expect(await archives({ vue: "n-importe-quoi" })).toEqual({ statut: 307, cible: "/stock/reconciliation?vue=comptages" });
  });

  it("la page et la taille de page suivent (un lien « page 3 » d'hier arrive à la page 3)", async () => {
    expect(await archives({ vue: "comptages", page: "3", par: "100" })).toEqual({ statut: 307, cible: "/stock/reconciliation?vue=comptages&page=3&par=100" });
  });

  it("?vue=bons → Bons de commande filtrés sur « Validés » (307)", async () => {
    expect(await archives({ vue: "bons" })).toEqual({ statut: 307, cible: "/stock/commandes?statut=VALIDE" });
  });

  it("?vue=rapports et ?vue=journal restent des pages (les deux vues qui restent aux Archives)", async () => {
    // Pas de redirection : la page lit ensuite la base, que ce test ne monte pas — on attend donc une erreur
    // de lecture, jamais un NEXT_REDIRECT.
    for (const vue of ["rapports", "journal"]) {
      let erreur: unknown = null;
      try {
        const { default: Page } = await import("./archives/page");
        await Page({ searchParams: Promise.resolve({ vue }) });
      } catch (e) { erreur = e; }
      expect((erreur as { digest?: string } | null)?.digest ?? "").not.toMatch(/^NEXT_REDIRECT/);
    }
  });

  it("la garde Stock est appelée avant la redirection", async () => {
    await archives({ vue: "bons" });
    expect(G.garde).toHaveBeenCalledTimes(1);
  });
});

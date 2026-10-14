// @vitest-environment happy-dom
//
// Fiche article : « Désactiver » / « Réactiver » (Direction, 2026-10-14) — la même action et la même règle que l'action groupée
// de l'Inventaire : Direction = tout de suite, autre compte = PROPOSITION. C'est ce qui donne enfin une suite au refus de
// suppression d'un article qui a un historique (« Désactivez-le »).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const A = vi.hoisted(() => ({ basculer: vi.fn<(...a: unknown[]) => Promise<unknown>>(), refresh: vi.fn() }));
vi.mock("../actions", () => ({ basculerActifArticles: (...a: unknown[]) => A.basculer(...a) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: A.refresh }) }));
const { ActivationArticle } = await import("./activation-article");

let conteneur: HTMLDivElement;
let racine: Root;
const monter = (p: { actif: boolean; estDirection: boolean }) => act(() => racine.render(h(ActivationArticle, { id: "a1", libelle: "Farine 25 kg", ...p })));
const bouton = () => conteneur.querySelector<HTMLButtonElement>("[data-activation-article]")!;
const cliquer = async () => { await act(async () => { bouton().click(); }); };
beforeEach(() => {
  A.basculer.mockReset(); A.refresh.mockReset();
  window.confirm = vi.fn(() => true);
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
});
afterEach(() => { act(() => racine.unmount()); conteneur.remove(); });

describe("Direction", () => {
  it("article actif : « Désactiver », après confirmation, appelle l'action groupée avec cet article seul, puis rafraîchit la fiche", async () => {
    A.basculer.mockResolvedValue(undefined);
    monter({ actif: true, estDirection: true });
    expect(bouton().textContent).toBe("Désactiver");
    await cliquer();
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("Désactiver « Farine 25 kg »"));
    expect(A.basculer).toHaveBeenCalledWith(["a1"], false);
    expect(A.refresh).toHaveBeenCalled();
  });

  it("confirmation refusée : rien n'est envoyé", async () => {
    window.confirm = vi.fn(() => false);
    monter({ actif: true, estDirection: true });
    await cliquer();
    expect(A.basculer).not.toHaveBeenCalled();
  });

  it("article désactivé : « Réactiver » (sans confirmation) appelle l'action avec actif = vrai", async () => {
    A.basculer.mockResolvedValue(undefined);
    monter({ actif: false, estDirection: true });
    expect(bouton().textContent).toBe("Réactiver");
    await cliquer();
    expect(window.confirm).not.toHaveBeenCalled();
    expect(A.basculer).toHaveBeenCalledWith(["a1"], true);
  });

  it("un refus du serveur s'affiche (jamais avalé) et la fiche n'est pas rafraîchie", async () => {
    A.basculer.mockResolvedValue({ erreur: "Accès refusé : rôle insuffisant." });
    monter({ actif: true, estDirection: true });
    await cliquer();
    expect(conteneur.querySelector('[role="alert"]')!.textContent).toBe("Accès refusé : rôle insuffisant.");
    expect(A.refresh).not.toHaveBeenCalled();
  });
});

describe("autre rôle : une proposition", () => {
  it("libellés « Proposer la désactivation / la réactivation » ; la réponse de proposition s'affiche avec le lien vers les demandes", async () => {
    A.basculer.mockResolvedValue({ proposition: true, message: "Proposition envoyée à la Direction : l'article ne change qu'après sa validation." });
    monter({ actif: true, estDirection: false });
    expect(bouton().textContent).toBe("Proposer la désactivation");
    await cliquer();
    expect(A.basculer).toHaveBeenCalledWith(["a1"], false);
    expect(conteneur.textContent).toContain("Proposition envoyée à la Direction");
    expect(conteneur.querySelector('a[href="/stock/a-valider"]')).toBeTruthy();
    act(() => racine.render(h(ActivationArticle, { id: "a1", libelle: "x", actif: false, estDirection: false })));
    expect(bouton().textContent).toBe("Proposer la réactivation");
  });
});

describe("la fiche et le refus de suppression", () => {
  it("la page de la fiche porte le bouton et le badge « Inactif » ; le refus de suppression mène à ce bouton", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const page = readFileSync(join(__dirname, "page.tsx"), "utf8");
    expect(page).toContain("<ActivationArticle id={a.id} actif={a.actif} libelle={libelle} estDirection={estDirection} />");
    expect(page).toContain("data-badge-inactif");
    const lib = readFileSync(join(__dirname, "..", "..", "..", "..", "..", "lib", "validations-stock", "suppression-article.ts"), "utf8");
    expect(lib).toContain("bouton « Désactiver » de sa fiche");
  });
});

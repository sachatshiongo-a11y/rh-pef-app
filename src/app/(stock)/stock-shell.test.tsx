// L'onglet « Catalogue » de l'espace Stock s'appelle « Inventaire » (demande de la Direction,
// 2026-09-28). Seul le libellé change : l'adresse /stock/catalogue reste la même, pour ne casser
// ni les favoris, ni les liens des notifications et des e-mails d'alerte déjà envoyés.
//
// Rendu serveur (renderToStaticMarkup) : pas de DOM simulé à installer, et c'est le HTML que le
// navigateur reçoit en premier.
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ usePathname: () => "/stock/catalogue", useRouter: () => ({ back: () => {}, push: () => {} }) }));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("@/app/login/actions", () => ({ logout: async () => {} }));
vi.mock("@/components/notification-bell", () => ({ NotificationBell: () => null }));
vi.mock("@/components/bouton-retour", () => ({ BoutonRetour: () => null }));

const { StockShell } = await import("./stock-shell");

/** Les liens du menu latéral (<nav>), texte visible et adresse. */
function liensDuMenu() {
  const html = renderToStaticMarkup(createElement(StockShell, { userNom: "Direction", userRole: "ADMIN", maPhoto: null, notif: null }, null));
  const nav = html.slice(html.indexOf("<nav"), html.indexOf("</nav>"));
  return [...nav.matchAll(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/g)].map((m) => ({
    href: m[1],
    texte: m[2].replace(/<[^>]+>/g, "").trim(),
  }));
}

describe("menu de l'espace Stock", () => {
  it("affiche « Inventaire » à l'adresse inchangée /stock/catalogue", () => {
    const liens = liensDuMenu();
    expect(liens.length).toBeGreaterThan(5); // le menu a bien été lu
    expect(liens.find((l) => l.texte === "Inventaire")?.href).toBe("/stock/catalogue");
  });

  it("n'affiche plus « Catalogue » nulle part dans le menu", () => {
    expect(liensDuMenu().filter((l) => /catalogue/i.test(l.texte))).toEqual([]);
  });
});

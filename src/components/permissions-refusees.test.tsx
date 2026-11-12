// @vitest-environment happy-dom
// « Exports » retiré à la personne : les liens de téléchargement du Stock disparaissent ; les factures restent.
import { describe, it, expect, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PermissionsRefuseesProvider } from "./permissions-refusees";
import { TelechargerLien } from "./telecharger-lien";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let conteneur: HTMLDivElement; let racine: Root;
afterEach(() => { act(() => racine.unmount()); conteneur.remove(); });
function rendre(refusees: string[]) {
  conteneur = document.createElement("div"); document.body.appendChild(conteneur); racine = createRoot(conteneur);
  const liens = [
    createElement(TelechargerLien, { key: "i", href: "/stock/catalogue/export?q=1", children: "Excel inventaire" }),
    createElement(TelechargerLien, { key: "f", href: "/stock/factures/export?ids=a", children: "Excel factures" }),
  ];
  act(() => racine.render(createElement(PermissionsRefuseesProvider, { refusees, children: liens })));
}

describe("liens d'export et permission « Exports »", () => {
  it("permission retirée : l'export du Stock est masqué, celui des factures reste", () => {
    rendre(["stock.exports"]);
    expect(conteneur.textContent).not.toContain("Excel inventaire");
    expect(conteneur.textContent).toContain("Excel factures");
  });
  it("permission présente : tout est affiché", () => {
    rendre([]);
    expect(conteneur.textContent).toContain("Excel inventaire");
    expect(conteneur.textContent).toContain("Excel factures");
  });
});

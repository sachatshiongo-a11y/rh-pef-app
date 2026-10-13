// @vitest-environment happy-dom
//
// Cloche du salarié : le chiffre est le total des non lues ; si le plafond de sécurité coupe la liste, la cloche le DIT
// (« 300 affichées sur N non lues »), rien n'est caché en silence (Direction, 13/10/2026).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("./actions", () => ({ marquerMesNotificationsLues: async () => {}, supprimerMaNotification: async () => {} }));
vi.mock("next/link", () => ({
  default: ({ href, children, onClick, className }: { href: string; children: React.ReactNode; onClick?: () => void; className?: string }) =>
    h("a", { href, onClick: (e: Event) => { e.preventDefault(); onClick?.(); }, className }, children),
}));

import { ClocheSalarie } from "./cloche-salarie";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const item = (id: string) => ({ id, type: "CONGE", message: `Notification ${id}`, lien: "/espace/conges", lu: false, createdAt: new Date() });

let conteneur: HTMLDivElement;
let racine: Root;
const clic = (el: Element) => act(() => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
const rendre = (props: Partial<React.ComponentProps<typeof ClocheSalarie>>) =>
  act(() => racine.render(h(ClocheSalarie, { items: [], nonLues: 0, ...props })));

beforeEach(() => { conteneur = document.createElement("div"); document.body.appendChild(conteneur); racine = createRoot(conteneur); });
afterEach(() => { act(() => racine.unmount()); conteneur.remove(); });

describe("cloche du salarié", () => {
  it("liste ce qu'elle compte et ne dit rien quand rien n'est coupé", async () => {
    await rendre({ items: [item("a"), item("b")], nonLues: 2, nonLuesListees: 2 });
    expect(conteneur.querySelector("button span")?.textContent).toBe("2");
    await clic(conteneur.querySelector('button[aria-label="Notifications"]')!);
    expect(conteneur.querySelectorAll("li")).toHaveLength(2);
    expect(conteneur.querySelector('[data-testid="cloche-plafond"]')).toBeNull();
  });

  it("annonce le plafond : « 300 affichées sur 302 non lues »", async () => {
    await rendre({ items: [item("a")], nonLues: 302, nonLuesListees: 300 });
    await clic(conteneur.querySelector('button[aria-label="Notifications"]')!);
    expect(conteneur.querySelector('[data-testid="cloche-plafond"]')?.textContent).toContain("300 affichées sur 302 non lues");
  });
});

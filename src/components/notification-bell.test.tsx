// @vitest-environment happy-dom
//
// LA CLOCHE UNIQUE (2026-10-12) : la même dans les espaces RH, Stock et Exploitation. Chaque notification porte
// l'étiquette de son espace ; le chiffre est le total des non lues ; « Tout marquer lu » n'a plus de domaine à
// donner (le serveur marque ce que le compte voit) ; un clic sur une notification la supprime et mène à son lien.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";

const actions = vi.hoisted(() => ({ marquer: vi.fn<(...args: unknown[]) => Promise<{ ok: boolean }>>(async () => ({ ok: true })), supprimer: vi.fn<(...args: unknown[]) => Promise<{ ok: boolean }>>(async () => ({ ok: true })) }));
vi.mock("@/app/(app)/notifications-actions", () => ({ marquerNotificationsLues: actions.marquer, supprimerNotification: actions.supprimer }));
vi.mock("next/link", () => ({
  default: ({ href, children, onClick, className }: { href: string; children: React.ReactNode; onClick?: () => void; className?: string }) =>
    h("a", { href, onClick: (e: Event) => { e.preventDefault(); onClick?.(); }, className }, children),
}));

import { NotificationBell } from "./notification-bell";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const item = (id: string, domaine: string | undefined, message: string, lien: string | null = "/a-valider") =>
  ({ id, domaine, type: "AUTRE", message, lien, lu: false, createdAt: new Date() });

let conteneur: HTMLDivElement;
let racine: Root;
const clic = (el: Element) => act(() => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
const rendre = (props: Partial<React.ComponentProps<typeof NotificationBell>> = {}) =>
  act(() => racine.render(h(NotificationBell, { items: [], nonLues: 0, cloture: null, ...props })));
const ouvrir = () => clic(conteneur.querySelector('button[aria-label="Notifications"]')!);

beforeEach(() => {
  actions.marquer.mockClear(); actions.supprimer.mockClear();
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
});
afterEach(() => { act(() => racine.unmount()); conteneur.remove(); });

const TROIS = [
  item("a", "RH", "Congé à valider"),
  item("b", "STOCK", "Bon de commande à valider", "/stock/a-valider"),
  item("c", "EXPLOITATION", "Demande de ratios reçue", "/exploitation/a-valider"),
];

describe("cloche unique", () => {
  it("chaque notification porte l'étiquette de son espace (RH, Stock, Exploitation) et garde son lien", async () => {
    await rendre({ items: TROIS, nonLues: 3 });
    await ouvrir();
    const lignes = [...conteneur.querySelectorAll("li")];
    expect(lignes).toHaveLength(3);
    expect(lignes.map((l) => [l.querySelector("span")?.textContent, l.querySelector("a")?.getAttribute("href")])).toEqual([
      ["RH", "/a-valider"], ["Stock", "/stock/a-valider"], ["Exploitation", "/exploitation/a-valider"],
    ]);
  });

  it("le chiffre de la cloche est le total des non lues (9+ au-delà), l'alerte de clôture compte pour une", async () => {
    await rendre({ items: TROIS, nonLues: 3 });
    expect(conteneur.querySelector("button span")?.textContent).toBe("3");
    await rendre({ items: TROIS, nonLues: 3, cloture: { message: "Clôture dans 2 j", jours: 2 } });
    expect(conteneur.querySelector("button span")?.textContent).toBe("4");
    await rendre({ items: TROIS, nonLues: 14 });
    expect(conteneur.querySelector("button span")?.textContent).toBe("9+");
  });

  it("une notification sans domaine connu n'a pas d'étiquette (jamais la valeur brute)", async () => {
    await rendre({ items: [item("x", undefined, "Ancienne"), item("y", "SALARIE", "Autre")], nonLues: 2 });
    await ouvrir();
    expect(conteneur.querySelectorAll("li span")).toHaveLength(0);
  });

  it("« Tout marquer lu » est un seul geste sans domaine : le serveur marque ce que le compte voit", async () => {
    await rendre({ items: TROIS, nonLues: 3 });
    await ouvrir();
    const bouton = [...conteneur.querySelectorAll("button")].find((b) => b.textContent === "Tout marquer lu")!;
    await clic(bouton);
    expect(actions.marquer).toHaveBeenCalledTimes(1);
    expect(actions.marquer.mock.calls[0]).toEqual([]);
  });

  it("cliquer sur une notification la supprime (le serveur revérifie le droit)", async () => {
    await rendre({ items: TROIS, nonLues: 3 });
    await ouvrir();
    await clic(conteneur.querySelectorAll("li a")[1]);
    expect(actions.supprimer).toHaveBeenCalledWith("b");
  });

  it("aucune notification : message simple, pas de « Tout marquer lu »", async () => {
    await rendre();
    await ouvrir();
    expect(conteneur.textContent).toContain("Aucune notification.");
    expect(conteneur.textContent).not.toContain("Tout marquer lu");
  });

  it("plafond de sécurité : la cloche DIT « 300 affichées sur 305 non lues » ; sans coupure, aucune annonce", async () => {
    await rendre({ items: TROIS, nonLues: 305, nonLuesListees: 300 });
    await ouvrir();
    expect(conteneur.querySelector('[data-testid="cloche-plafond"]')?.textContent).toContain("300 affichées sur 305 non lues");
    expect(conteneur.querySelector('button[aria-label="Notifications"]')?.getAttribute("title")).toBe("Notifications : 300 affichées sur 305 non lues");
    await rendre({ items: TROIS, nonLues: 3, nonLuesListees: 3 });
    expect(conteneur.querySelector('[data-testid="cloche-plafond"]')).toBeNull();
    expect(conteneur.querySelector('button[aria-label="Notifications"]')?.getAttribute("title")).toBe("Notifications");
  });
});

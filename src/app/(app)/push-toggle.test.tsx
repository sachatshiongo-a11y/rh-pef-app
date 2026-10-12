// @vitest-environment happy-dom
//
// Interrupteur des notifications : le refus du serveur (service push inconnu, abonnement d'un autre compte)
// est DIT, et l'interrupteur ne reste pas sur « activées » (audit du 10/10/2026, ergonomie 1 et 14).
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";

const m = vi.hoisted(() => ({
  enregistrer: vi.fn<(s: unknown) => Promise<unknown>>(async () => ({ ok: true })),
  supprimer: vi.fn<(e: string) => Promise<unknown>>(async () => ({ ok: true })),
  desabonner: vi.fn(async () => true),
}));
vi.mock("./push-actions", () => ({ enregistrerPush: m.enregistrer, supprimerPush: m.supprimer }));
vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "AQAB");

const { PushToggle } = await import("./push-toggle");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let conteneur: HTMLDivElement;
let racine: Root;
let abonne = false;
function installerNavigateur() {
  const sub = { endpoint: "https://fcm.googleapis.com/x", toJSON: () => ({ keys: { p256dh: "k", auth: "a" } }), unsubscribe: m.desabonner };
  const reg = {
    pushManager: {
      getSubscription: async () => (abonne ? sub : null),
      subscribe: async () => { abonne = true; return sub; },
    },
  };
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { register: async () => reg, getRegistration: async () => reg } });
  (window as unknown as Record<string, unknown>).PushManager = class {};
  (window as unknown as Record<string, unknown>).Notification = Object.assign(class {}, { permission: "granted", requestPermission: async () => "granted" });
}
beforeEach(async () => {
  abonne = false;
  installerNavigateur();
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () => racine.render(h(PushToggle)));
});
afterEach(() => { act(() => racine.unmount()); conteneur.remove(); vi.clearAllMocks(); });

const bouton = () => conteneur.querySelector("button")!;
const cliquer = async () => { await act(async () => bouton().click()); };

describe("PushToggle", () => {
  it("activation acceptée : « Notifications activées »", async () => {
    await cliquer();
    expect(bouton().textContent).toContain("activées");
    expect(conteneur.querySelector('[role="alert"]')).toBeNull();
  });

  it("activation REFUSÉE par le serveur : le message est affiché, le navigateur est désabonné, l'interrupteur reste sur « Activer »", async () => {
    m.enregistrer.mockResolvedValueOnce({ erreur: "Ce service de notification n'est pas reconnu." });
    await cliquer();
    expect(conteneur.querySelector('[role="alert"]')?.textContent).toBe("Ce service de notification n'est pas reconnu.");
    expect(m.desabonner).toHaveBeenCalled();
    expect(bouton().textContent).toContain("Activer les notifications");
  });

  it("désactivation refusée par le serveur : le message est affiché", async () => {
    await cliquer(); // active
    m.supprimer.mockResolvedValueOnce({ erreur: "Cet abonnement appartient à un autre compte." });
    await cliquer(); // désactive
    expect(conteneur.querySelector('[role="alert"]')?.textContent).toBe("Cet abonnement appartient à un autre compte.");
  });
});

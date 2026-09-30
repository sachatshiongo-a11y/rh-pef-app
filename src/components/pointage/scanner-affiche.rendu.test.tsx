// @vitest-environment happy-dom
//
// « Scanner = pointer » (décision de la Direction du 2026-09-29) : la page `/scan?c=…` ouverte avec
// une session POINTE TOUTE SEULE, sans aucun clic — depuis le script de la page, après son
// chargement (le rendu serveur, lui, ne pointe rien : cf. `app/scan/scan-get.integration.test.ts`).
// Le composant est rendu pour de vrai (React + DOM simulé) ; l'action serveur est simulée.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StrictMode, act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ResultatScan } from "@/lib/pointage-scan";

const m = vi.hoisted(() => ({
  scannerAffiche: vi.fn(),
  annulerPointage: vi.fn(),
  saisirMaPause: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@/app/pointage/actions", () => ({
  scannerAffiche: m.scannerAffiche,
  annulerPointage: m.annulerPointage,
  saisirMaPause: m.saisirMaPause,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: m.refresh, push: () => {}, replace: () => {} }) }));

const { ScannerAffiche } = await import("./scanner-affiche");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// 8 h 02 à Kinshasa (UTC+1).
const ARRIVEE_8H02 = "2026-09-23T07:02:00.000Z";
const ARRIVEE: ResultatScan = {
  etat: "ARRIVEE", scanId: "scan-1", heure: ARRIVEE_8H02, verdict: { verdict: "AU_RESTAURANT", distanceM: 12 }, repete: false,
  annulableMs: 300_000,
};

type Geoloc = { getCurrentPosition: (ok: (p: unknown) => void, ko: (e: unknown) => void) => void };
function geolocalisation(g: Geoloc | undefined) {
  Object.defineProperty(navigator, "geolocation", { value: g, configurable: true });
}
const positionImmediate: Geoloc = {
  getCurrentPosition: (ok) => ok({ coords: { latitude: -4.3218, longitude: 15.3126, accuracy: 20 } }),
};

let conteneur: HTMLDivElement;
let racine: Root;
beforeEach(() => {
  m.scannerAffiche.mockReset().mockResolvedValue(ARRIVEE);
  m.annulerPointage.mockReset().mockResolvedValue({ moment: "ARRIVEE", heure: ARRIVEE_8H02 });
  m.saisirMaPause.mockReset();
  m.refresh.mockReset();
  window.history.replaceState(null, "", "/scan?c=CODE-AFFICHE");
  geolocalisation(positionImmediate);
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
});
afterEach(() => {
  act(() => racine.unmount());
  conteneur.remove();
  vi.useRealTimers();
});

/** Laisse passer les promesses (position, action serveur) et les rendus qui suivent. */
async function laisserFiler() {
  for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); });
}

describe("/scan?c=… avec session : le pointage part tout seul", () => {
  it("SANS AUCUN CLIC : une seule action envoyée (même en mode strict), avec le code et la position ; « Arrivée enregistrée » en grand", async () => {
    await act(async () => racine.render(createElement(StrictMode, null, createElement(ScannerAffiche, { codeInitial: "CODE-AFFICHE" }))));
    await laisserFiler();

    expect(m.scannerAffiche).toHaveBeenCalledTimes(1);
    expect(m.scannerAffiche).toHaveBeenCalledWith({ code: "CODE-AFFICHE", position: { lat: -4.3218, lng: 15.3126, precisionM: 20 } });
    expect(conteneur.textContent).toContain("Arrivée enregistrée à 8 h 02");
    expect(conteneur.textContent).toContain("Heure du serveur");
    expect(conteneur.textContent).not.toContain("Pointer maintenant");
    // Le code est retiré de l'adresse : un rechargement de l'onglet ne rejoue pas l'affiche.
    expect(window.location.search).toBe("");
  });

  it("sans position au bout de 8 s, le pointage part QUAND MÊME (position indisponible → « à vérifier » côté serveur)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    geolocalisation({ getCurrentPosition: () => {} }); // invite laissée ouverte : jamais de réponse
    await act(async () => racine.render(createElement(ScannerAffiche, { codeInitial: "CODE-AFFICHE" })));
    await laisserFiler();
    expect(m.scannerAffiche).not.toHaveBeenCalled();

    await act(async () => { vi.advanceTimersByTime(8_000); });
    await laisserFiler();
    expect(m.scannerAffiche).toHaveBeenCalledTimes(1);
    expect(m.scannerAffiche).toHaveBeenCalledWith({ code: "CODE-AFFICHE", position: { erreur: "INDISPONIBLE" } });
  });

  it("sans code dans l'adresse, rien n'est envoyé au chargement (la caméra attend un code)", async () => {
    window.history.replaceState(null, "", "/pointer");
    await act(async () => racine.render(createElement(ScannerAffiche, {})));
    await laisserFiler();
    expect(m.scannerAffiche).not.toHaveBeenCalled();
  });

  it("« Annuler ce pointage » est proposé, et annule CE scan", async () => {
    await act(async () => racine.render(createElement(ScannerAffiche, { codeInitial: "CODE-AFFICHE" })));
    await laisserFiler();
    const bouton = [...conteneur.querySelectorAll("button")].find((b) => b.textContent === "Annuler ce pointage");
    expect(bouton).toBeDefined();

    await act(async () => bouton!.click());
    await laisserFiler();
    expect(m.annulerPointage).toHaveBeenCalledWith({ scanId: "scan-1" });
    expect(conteneur.textContent).toContain("Pointage annulé.");
  });
});

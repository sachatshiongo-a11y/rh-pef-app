// @vitest-environment happy-dom
//
// Aperçu de l'import de pointage IVMS — pagination (2026-10-08) : un mois fait des milliers de lignes
// (employés × jours). 50 / 100 / Tout ; la période, la sélection et l'import portent sur TOUTES les lignes
// de la période ; la case d'en-tête coche la page ; les anomalies ne s'arrêtent plus où que ce soit.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// 120 jours pour un salarié : 110 importables, 10 en congé (jours 1 à 10).
const LIGNES = Array.from({ length: 120 }, (_, i) => ({
  employeeId: "e1", nom: "Awa", matricule: "M1", date: new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString().slice(0, 10), heures: 8, code: "P" as const,
  statut: i < 10 ? ("CONGE" as const) : ("OK" as const),
}));
const ANOMALIES = Array.from({ length: 60 }, (_, i) => ({ date: "2026-01-01", idExterne: `X${i + 1}`, type: "inconnu", detail: "non apparié" }));
const appliquerPointageIVMS = vi.fn(async (..._a: unknown[]) => ({ ok: true, message: "ok" }));
vi.mock("./import-actions", () => ({
  analyserPointageIVMS: vi.fn(async () => ({ ok: true, message: "120 jours lus", lignes: LIGNES, anomalies: ANOMALIES, dateMin: LIGNES[0].date, dateMax: LIGNES[119].date })),
  appliquerPointageIVMS: (...a: unknown[]) => appliquerPointageIVMS(...a),
}));

const { ImportPointage } = await import("./import-pointage");

let conteneur: HTMLDivElement;
let racine: Root;
beforeEach(async () => {
  appliquerPointageIVMS.mockClear();
  window.history.replaceState(null, "", "/presences");
  conteneur = document.createElement("div"); document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(h(ImportPointage)));
  await act(async () => { conteneur.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
});
afterEach(() => { act(() => racine.unmount()); conteneur.remove(); });

const clic = (el: Element) => act(() => (el as HTMLElement).click());
const lignes = () => conteneur.querySelectorAll("tbody tr input[type=checkbox]").length;
const bouton = (label: string) => conteneur.querySelector<HTMLButtonElement>(`nav[data-pagination] button[aria-label="${label}"]`)!;
const parTexte = (t: string) => [...conteneur.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes(t))!;

describe("aperçu de l'import de pointage paginé", () => {
  it("50 lignes par page sur 120, l'URL n'est pas touchée (aperçu éphémère)", () => {
    expect(lignes()).toBe(50);
    expect(conteneur.querySelectorAll("[data-pagination-compteur]")[0].textContent).toContain("1–50 sur 120");
    clic(bouton("Page suivante"));
    expect(conteneur.querySelectorAll("[data-pagination-compteur]")[0].textContent).toContain("51–100 sur 120");
    expect(window.location.search).toBe("");
    clic(bouton("Afficher tout"));
    expect(lignes()).toBe(120);
  });

  it("la sélection porte sur toute la période : 110 à importer, envoyées en un coup", async () => {
    expect(conteneur.textContent).toContain("110 à importer (toutes pages)");
    await act(async () => { parTexte("Importer la sélection").click(); });
    expect((appliquerPointageIVMS.mock.calls[0][0] as unknown[])).toHaveLength(110);
  });

  it("la case d'en-tête décoche la page (40 importables en page 1) ; Tout cocher / décocher visent toute la période", () => {
    act(() => { conteneur.querySelector<HTMLInputElement>("thead input[type=checkbox]")!.click(); });
    expect(conteneur.textContent).toContain("70 à importer (toutes pages)"); // 110 - 40 (les 10 congés ne comptent pas)
    expect(parTexte("Tout cocher").textContent).toBe("Tout cocher (110)");
    clic(parTexte("Tout cocher"));
    expect(conteneur.textContent).toContain("110 à importer");
    clic(parTexte("Tout décocher"));
    expect(conteneur.textContent).toContain("0 à importer");
  });

  it("les anomalies sont paginées (60 → 2 pages), la dernière reste atteignable", () => {
    const barres = conteneur.querySelectorAll("nav[data-pagination]");
    expect(barres).toHaveLength(2); // l'aperçu + les anomalies
    const lis = () => conteneur.querySelectorAll("li").length;
    expect(lis()).toBe(50);
    clic(barres[1].querySelector<HTMLButtonElement>('button[aria-label="Page suivante"]')!);
    expect(lis()).toBe(10);
  });
});

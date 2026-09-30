// @vitest-environment happy-dom
//
// Sélecteur de jour du téléphone : L M M J V S D, jour courant par défaut, changement de jour partagé
// avec la liste, « Vue semaine » qui remplace la rangée, et rang ramené dans la liste (6 jours).
import { describe, it, expect, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { JourMobileProvider } from "./jour-mobile";
import { SelecteurJour, BasculeVueSemaine, useJourAffiche } from "./selecteur-jour";
import { VueJourOuSemaine } from "./vue-jour-semaine";
import { rangJourParDefaut } from "@/lib/jour-mobile";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SEMAINE = ["2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"];

let conteneur: HTMLDivElement;
let racine: Root;
afterEach(() => { act(() => racine.unmount()); conteneur.remove(); });

/** Un petit corps qui lit le jour affiché, comme les listes du jour. */
function Corps({ isos }: { isos: string[] }) {
  const [rang] = useJourAffiche(isos);
  return <p data-corps="">{isos[rang]}</p>;
}
function monter(isos: string[], aujourdhui: string) {
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(
    <JourMobileProvider defaultIdx={rangJourParDefaut(isos, aujourdhui)}>
      <SelecteurJour jours={isos.map((iso) => ({ iso }))} aujourdhui={aujourdhui} />
      <BasculeVueSemaine />
      <Corps isos={isos} />
      <VueJourOuSemaine jour={<i id="jour" />} semaine={<b id="semaine" />} />
    </JourMobileProvider>,
  ));
}
const boutons = () => [...conteneur.querySelectorAll<HTMLButtonElement>("[data-selecteur-jour] button")];
const corps = () => conteneur.querySelector("[data-corps]")!.textContent;

describe("sélecteur de jour (téléphone)", () => {
  it("sept pastilles L M M J V S D avec la date, le jour courant choisi par défaut", () => {
    monter(SEMAINE, "2026-09-30");
    expect(boutons().map((b) => b.textContent)).toEqual(["L28", "M29", "M30", "J1", "V2", "S3", "D4"]);
    expect(boutons().map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "false", "true", "false", "false", "false", "false"]);
    expect(corps()).toBe("2026-09-30");
    // Le libellé complet est lu par les lecteurs d'écran, et « aujourd'hui » est dit.
    expect(boutons()[2]!.getAttribute("aria-label")).toBe("mercredi 30 septembre (aujourd'hui)");
    expect(boutons()[3]!.getAttribute("aria-label")).toBe("jeudi 1 octobre");
  });

  it("aujourd'hui hors de la semaine affichée : le premier jour", () => {
    monter(SEMAINE, "2026-10-12");
    expect(corps()).toBe("2026-09-28");
    expect(boutons()[0]!.getAttribute("aria-pressed")).toBe("true");
  });

  it("choisir un jour change ce que la liste affiche", () => {
    monter(SEMAINE, "2026-09-30");
    act(() => { boutons()[4]!.click(); });
    expect(corps()).toBe("2026-10-02");
    expect(boutons()[4]!.getAttribute("aria-pressed")).toBe("true");
  });

  it("chaque pastille fait au moins 44 px de haut", () => {
    monter(SEMAINE, "2026-09-30");
    for (const b of boutons()) expect(b.className).toMatch(/min-h-12|min-h-11/);
  });

  it("six jours (Rapport journalier sans dimanche) : six pastilles, jamais de rang hors liste", () => {
    monter(SEMAINE.slice(0, 6), "2026-10-04"); // dimanche : absent de la liste
    expect(boutons()).toHaveLength(6);
    expect(corps()).toBe("2026-09-28");
  });

  it("« Vue semaine » : la rangée cède la place à un retour au jour, et la vue semaine s'affiche", () => {
    monter(SEMAINE, "2026-09-30");
    expect(conteneur.querySelector('[data-vue="jour"]')!.className).toContain("lg:hidden");
    expect(conteneur.querySelector('[data-vue="semaine"]')!.className).toContain("max-lg:hidden");
    act(() => { [...conteneur.querySelectorAll("button")].find((b) => b.textContent?.includes("Vue semaine"))!.click(); });
    expect(boutons().map((b) => b.textContent)).toEqual(["Revenir au jour"]);
    expect(conteneur.querySelector('[data-vue="jour"]')!.className).toBe("hidden");
    expect(conteneur.querySelector('[data-vue="semaine"]')!.className).toBe("");
    act(() => { boutons()[0]!.click(); });
    expect(boutons()).toHaveLength(7);
    expect(corps()).toBe("2026-09-30"); // le jour choisi est conservé
  });

  it("invisible dès lg : l'ordinateur garde ses tableaux", () => {
    monter(SEMAINE, "2026-09-30");
    expect(conteneur.querySelector("[data-selecteur-jour]")!.className).toContain("lg:hidden");
  });
});

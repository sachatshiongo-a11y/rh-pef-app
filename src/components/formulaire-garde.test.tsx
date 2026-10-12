// @vitest-environment happy-dom
//
// FormulaireGarde + BoutonEnvoi (audit du 10/10/2026, ergonomie 2 et 5) : un refus du serveur ne vide plus
// le formulaire ; le bouton d'envoi attend la réponse (un seul envoi même si l'on clique deux fois).
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { FormulaireGarde } from "./formulaire-garde";
import { BoutonEnvoi } from "./bouton-envoi";
import { CHAMP_RETOUR_ERREUR } from "@/lib/erreur-formulaire";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let conteneur: HTMLDivElement;
let racine: Root;
function monter(action: (fd: FormData) => unknown, props: { reinitialiser?: boolean } = {}) {
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(
    h(FormulaireGarde, { action: action as (fd: FormData) => Promise<unknown>, ...props },
      h("input", { name: "motif", defaultValue: "" }),
      h(BoutonEnvoi, null, "Ajouter"),
    ),
  ));
}
afterEach(() => { act(() => racine.unmount()); conteneur.remove(); });

const champ = () => conteneur.querySelector<HTMLInputElement>('input[name="motif"]')!;
const bouton = () => conteneur.querySelector<HTMLButtonElement>("button")!;
function saisir(valeur: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(champ(), valeur);
  act(() => { champ().dispatchEvent(new Event("input", { bubbles: true })); });
}
async function envoyer() { await act(async () => { conteneur.querySelector("form")!.requestSubmit(); }); }

describe("FormulaireGarde — la saisie survit à un refus", () => {
  it("refus rendu comme valeur ({ erreur }) : message affiché, saisie intacte", async () => {
    const action = vi.fn(async () => ({ erreur: "Montant supérieur au plafond." }));
    monter(action);
    saisir("Avance médicale");
    await envoyer();
    expect(action).toHaveBeenCalledTimes(1);
    expect(conteneur.querySelector('[role="alert"]')?.textContent).toBe("Montant supérieur au plafond.");
    expect(champ().value).toBe("Avance médicale");
  });

  it("demande au serveur de RENDRE le refus (CHAMP_RETOUR_ERREUR) au lieu de rediriger : une redirection démonterait le formulaire", async () => {
    const action = vi.fn(async (_fd: FormData) => ({ erreur: "Certificat illisible." }));
    monter(action);
    saisir("Avance médicale");
    await envoyer();
    const envoye = action.mock.calls[0][0];
    expect(envoye.get(CHAMP_RETOUR_ERREUR)).toBe("1");
    expect(envoye.get("motif")).toBe("Avance médicale");
    expect(champ().value).toBe("Avance médicale");
  });

  it("réussite : le formulaire est vidé (comme React le faisait), sans message", async () => {
    monter(vi.fn(async () => undefined));
    saisir("Avance médicale");
    await envoyer();
    expect(champ().value).toBe("");
    expect(conteneur.querySelector('[role="alert"]')).toBeNull();
  });

  it("réussite avec reinitialiser={false} : la saisie reste (fiche qui se modifie)", async () => {
    monter(vi.fn(async () => undefined), { reinitialiser: false });
    saisir("Avance médicale");
    await envoyer();
    expect(champ().value).toBe("Avance médicale");
  });
});

describe("BoutonEnvoi — attend la réponse", () => {
  it("désactivé et « Envoi… » pendant l'envoi ; un second envoi n'appelle pas l'action une deuxième fois", async () => {
    let finir!: () => void;
    const action = vi.fn(() => new Promise<void>((ok) => { finir = ok; }));
    monter(action);
    saisir("Avance médicale");
    await envoyer();
    expect(bouton().disabled).toBe(true);
    expect(bouton().textContent).toBe("Envoi…");
    await envoyer(); // deuxième clic / Entrée répétée
    expect(action).toHaveBeenCalledTimes(1);
    await act(async () => { finir(); });
    expect(bouton().disabled).toBe(false);
    expect(bouton().textContent).toBe("Ajouter");
  });
});

// Refus visible en haut ET en bas (Direction, 2026-10-12) : un long formulaire se refuse près de son bouton d'envoi.
describe("FormulaireGarde — le refus s'affiche en haut ET en bas", () => {
  const bandeaux = () => [...conteneur.querySelectorAll<HTMLElement>("[data-refus]")];
  const refus = () => vi.fn(async () => ({ erreur: "Matricule déjà utilisé." }));

  it("le même message deux fois ; UN SEUL porte role=alert (le haut), le bas est masqué aux lecteurs d'écran", async () => {
    monter(refus());
    await envoyer();
    const [haut, bas] = bandeaux();
    expect(bandeaux().map((b) => b.dataset.refus)).toEqual(["haut", "bas"]);
    expect(haut.textContent).toBe("Matricule déjà utilisé.");
    expect(bas.textContent).toBe("Matricule déjà utilisé.");
    expect(haut.getAttribute("role")).toBe("alert");
    expect(bas.getAttribute("role")).toBeNull();
    expect(bas.getAttribute("aria-hidden")).toBe("true");
    expect(conteneur.querySelectorAll('[role="alert"]')).toHaveLength(1);
    // Le haut est avant les champs, le bas après (près du bouton d'envoi).
    const ordre = [...conteneur.querySelectorAll("form > *")].map((n) => n.getAttribute("data-refus") ?? n.tagName.toLowerCase());
    expect(ordre.indexOf("haut")).toBeLessThan(ordre.indexOf("input"));
    expect(ordre.indexOf("bas")).toBeGreaterThan(ordre.indexOf("input"));
  });

  it("aucun refus : aucun des deux bandeaux", async () => {
    monter(vi.fn(async () => undefined));
    await envoyer();
    expect(bandeaux()).toHaveLength(0);
  });

  describe("la page ramène le bon bandeau à l'écran", () => {
    let defile: ReturnType<typeof vi.fn>;
    // Positions (px, repère de l'écran, 768 de haut) de chaque élément mesuré.
    let place: { haut: number; bas: number; bouton: number };
    beforeEach(() => {
      defile = vi.fn();
      Element.prototype.scrollIntoView = defile as unknown as Element["scrollIntoView"];
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
        const top = this.dataset.refus === "haut" ? place.haut : this.dataset.refus === "bas" ? place.bas : this.tagName === "BUTTON" ? place.bouton : 0;
        return { top, bottom: top + 20, left: 0, right: 100, width: 100, height: 20, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
      });
    });
    afterEach(() => { vi.restoreAllMocks(); });
    const envoyerParLeBouton = async () => { await act(async () => { (conteneur.querySelector("form") as HTMLFormElement).requestSubmit(bouton()); }); };

    it("bouton en bas d'un long formulaire, haut hors de vue : défile jusqu'au bandeau du BAS", async () => {
      place = { haut: -1800, bas: 2300, bouton: 2330 };
      monter(refus());
      await envoyerParLeBouton();
      expect(defile).toHaveBeenCalledTimes(1);
      expect(defile.mock.contexts[0]).toBe(bandeaux()[1]);
    });

    it("bouton en haut (barre d'envoi fixe), bas hors de vue : défile jusqu'au bandeau du HAUT", async () => {
      place = { haut: -1800, bas: 2300, bouton: -1830 };
      monter(refus());
      await envoyerParLeBouton();
      expect(defile).toHaveBeenCalledTimes(1);
      expect(defile.mock.contexts[0]).toBe(bandeaux()[0]);
    });

    it("un des deux bandeaux est déjà à l'écran : la page ne bouge pas", async () => {
      place = { haut: -1800, bas: 500, bouton: 530 };
      monter(refus());
      await envoyerParLeBouton();
      expect(defile).not.toHaveBeenCalled();
    });
  });
});

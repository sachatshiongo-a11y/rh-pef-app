// @vitest-environment happy-dom
//
// FormulaireGarde + BoutonEnvoi (audit du 10/10/2026, ergonomie 2 et 5) : un refus du serveur ne vide plus
// le formulaire ; le bouton d'envoi attend la réponse (un seul envoi même si l'on clique deux fois).
import { describe, it, expect, vi, afterEach } from "vitest";
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

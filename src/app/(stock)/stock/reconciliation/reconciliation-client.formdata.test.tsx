// @vitest-environment happy-dom
//
// FORMDATA DU COMPTAGE — figé avant la refonte de l'écran (domaines par pilules, barre du bas, 2026-10-09).
// `lireComptesSaisis` (src/lib/validations-stock/comptage.ts) lit ces champs : les noms, l'ordre et le
// contenu du FormData ne doivent pas bouger, quelle que soit la présentation de l'écran.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { lireComptesSaisis } from "@/lib/validations-stock/comptage";

const appliquer = vi.fn(async (fd: FormData) => { void fd; return { applique: true, nbEcarts: 1 }; });
vi.mock("./actions", () => ({ appliquerComptage: (fd: FormData) => appliquer(fd) }));
vi.mock("next/link", () => ({ default: (p: { href: string; children: unknown }) => createElement("a", { href: p.href }, p.children as never) }));

import { ReconciliationForm } from "./reconciliation-client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ARTICLES = [
  { id: "a1", code: "1", designation: "Tomate", categorie: "Légumes", theorique: 10, domaine: "NOURRITURE" },
  { id: "a2", code: "2", designation: "Oignon", categorie: "Légumes", theorique: 5, domaine: "NOURRITURE" },
  { id: "a3", code: "3", designation: "Primus", categorie: "Bières", theorique: 20, domaine: "BOISSON" },
];

let conteneur: HTMLDivElement;
let racine: Root;
function monter(props: Record<string, unknown> = {}) {
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(createElement(ReconciliationForm, { articles: ARTICLES, ...props })));
}
beforeEach(() => { window.history.replaceState(null, "", "/stock/reconciliation"); appliquer.mockClear(); });
afterEach(() => { act(() => racine.unmount()); conteneur.remove(); });

function taper(el: HTMLInputElement, texte: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => { setter.call(el, texte); el.dispatchEvent(new Event("input", { bubbles: true })); });
}
async function compter(nom: string, valeur: string) {
  const el = conteneur.querySelector<HTMLInputElement>(`[aria-label="Quantité physique — ${nom}"]`)!;
  act(() => el.focus());
  taper(el, valeur);
  await act(async () => el.blur());
}
const formulaire = () => conteneur.querySelector("form")!;
const envoyer = async () => { await act(async () => { formulaire().requestSubmit(); }); };
const champs = () => {
  const fd = new FormData(formulaire());
  return {
    ids: fd.getAll("recon_articleId"), physique: fd.getAll("recon_physique"), explication: fd.getAll("recon_explication"),
    domaine: fd.get("domaine"), origine: fd.get("origine"),
  };
};

describe("FormData du comptage", () => {
  it("une ligne par article : id, physique, explication (vide si dans la tolérance), libellé", async () => {
    monter();
    await compter("Tomate", "9,5"); // -5 % : dans la tolérance
    taper(conteneur.querySelector<HTMLInputElement>('input[name="origine"]')!, "Inventaire fin de mois");
    expect(champs()).toEqual({ ids: ["a1", "a2", "a3"], physique: ["9,5", "", ""], explication: ["", "", ""], domaine: null, origine: "Inventaire fin de mois" });
  });

  it("écart > 10 % : le champ d'explication prend la place du vide, au rang de l'article", async () => {
    monter();
    await compter("Oignon", "2"); // -60 %
    const expl = conteneur.querySelector<HTMLInputElement>('input[name="recon_explication"][required]')!;
    expect(expl).not.toBeNull();
    taper(expl, "Casse");
    expect(champs().explication).toEqual(["", "Casse", ""]);
  });

  it("Soumettre envoie ce FormData à l'action, lisible par lireComptesSaisis", async () => {
    monter();
    await compter("Tomate", "9,5");
    await compter("Oignon", "2");
    taper(conteneur.querySelector<HTMLInputElement>('input[name="recon_explication"][required]')!, "Casse");
    await envoyer();
    expect(appliquer).toHaveBeenCalledTimes(1);
    const lu = lireComptesSaisis(appliquer.mock.calls[0][0]);
    expect(lu.comptes).toEqual([
      { articleId: "a1", physique: 9.5, explication: "" },
      { articleId: "a2", physique: 2, explication: "Casse" },
    ]);
    expect(lu.domaine).toBeNull();
  });

  it("hors Direction, le bouton parle de soumission ; pour la Direction, d'application", () => {
    monter();
    expect(conteneur.textContent).toContain("Soumettre le comptage");
    act(() => racine.unmount()); conteneur.remove();
    monter({ estDirection: true });
    expect(conteneur.textContent).toContain("Appliquer le comptage");
  });

  it("le domaine choisi part dans le champ caché `domaine`", () => {
    monter({ domaine: "BOISSON", articles: ARTICLES.filter((a) => a.domaine === "BOISSON") });
    expect(champs()).toMatchObject({ ids: ["a3"], domaine: "BOISSON" });
  });
});

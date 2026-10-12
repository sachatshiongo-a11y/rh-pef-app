// @vitest-environment happy-dom
//
// Bon de commande, écran de saisie (2026-10-16) : devise $ / FC choisie à la création ; prix proposé depuis le prix de
// l'article DANS SA devise de saisie, converti au taux du jour (« ≈ ») seulement s'il est dans l'autre devise ; prix et
// totaux dans la devise du bon (aucun « $ » en francs) ; ligne sans prix « — » et total « incomplet ».
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";

const { creer } = vi.hoisted(() => ({ creer: vi.fn(async () => ({})) }));
vi.mock("../actions", () => ({ creerBonCommande: creer, modifierBonCommande: vi.fn(async () => ({})) }));
import { NouveauBonForm } from "./nouveau-client";
import { champChoix, choisirOption } from "@/lib/test/choix-recherche";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Farine : prix de référence en DOLLARS (1,50 $) ; Huile : prix de référence en FRANCS (7 000 FC), converti en dollars au taux 2 800.
const ARTICLES = [
  { id: "a1", designation: "Farine", prix: "1.5", prixCDF: "4200", refDevise: "USD" as const, prixRef: "1,50 $", uniteParCarton: null },
  { id: "a2", designation: "Huile", prix: "2.5", prixCDF: "7000", refDevise: "CDF" as const, prixRef: "7 000 FC", prixFC: "7 000 FC", uniteParCarton: null },
];
let conteneur: HTMLDivElement;
let racine: Root;
const monter = (initial?: Parameters<typeof NouveauBonForm>[0]["initial"]) => act(() => racine.render(h(NouveauBonForm, { articles: ARTICLES, fournisseurs: [{ id: "f1", nom: "Seneve" }], taux: 2800, initial })));
beforeEach(() => { creer.mockClear(); conteneur = document.createElement("div"); document.body.appendChild(conteneur); racine = createRoot(conteneur); });
afterEach(() => { act(() => racine.unmount()); conteneur.remove(); document.body.innerHTML = ""; });

const bouton = (t: string) => [...conteneur.querySelectorAll("button")].find((b) => b.textContent?.trim() === t)!;
const cachés = (name: string) => [...conteneur.querySelectorAll<HTMLInputElement>(`input[type="hidden"][name="${name}"]`)].map((i) => i.value);
const saisir = async (label: string, texte: string) => {
  const el = conteneur.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => { el.focus(); setter.call(el, texte); el.dispatchEvent(new Event("input", { bubbles: true })); el.blur(); });
};

describe("bon de commande — devise du bon", () => {
  it("par défaut en dollars : la devise part avec le formulaire, en-tête « P.U. USD »", () => {
    monter();
    expect(cachés("devise")).toEqual(["USD"]);
    expect(conteneur.textContent).toContain("P.U. USD");
    expect(bouton("Dollars ($)").getAttribute("aria-pressed")).toBe("true");
  });

  it("en francs : en-tête « P.U. FC », le prix du catalogue en dollars est proposé CONVERTI au taux du jour, annoncé « ≈ »", async () => {
    monter();
    await act(async () => bouton("Francs (FC)").click());
    expect(cachés("devise")).toEqual(["CDF"]);
    expect(conteneur.textContent).toContain("P.U. FC");
    await choisirOption(champChoix(conteneur, "Article, ligne 1"), "a1");
    expect(cachés("ligne_prix")[0]).toBe("4200"); // 1,50 $ × 2 800 : proposé, modifiable
    expect(conteneur.textContent).toContain("1,50 $ ≈"); // le prix de référence est en dollars : la conversion est annoncée
  });

  it("l'article dont le prix de référence est en francs : exact en FC, « ≈ » seulement en dollars", async () => {
    monter();
    await choisirOption(champChoix(conteneur, "Article, ligne 1"), "a2");
    expect(cachés("ligne_prix")[0]).toBe("2,5"); // bon en dollars : 7 000 FC ÷ 2 800, annoncé « ≈ »
    expect(conteneur.textContent).toContain("7 000 FC ≈");
    await act(async () => bouton("Francs (FC)").click());
    expect(cachés("ligne_prix")[0]).toBe("7000"); // exact, sans conversion
    expect(conteneur.textContent).not.toContain("7 000 FC ≈");
  });

  it("totaux en francs : jamais de « $ », ligne sans prix « sans prix », total « incomplet »", async () => {
    monter();
    await act(async () => bouton("Francs (FC)").click());
    await choisirOption(champChoix(conteneur, "Article, ligne 1"), "a2");
    await saisir("Quantité, ligne 1", "3");
    await act(async () => { conteneur.querySelectorAll<HTMLInputElement>('input[name="ligne_designation"]')[1].focus(); });
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => { const d = conteneur.querySelectorAll<HTMLInputElement>('input[name="ligne_designation"]')[1]; setter.call(d, "Transport"); d.dispatchEvent(new Event("input", { bubbles: true })); });
    await saisir("Quantité, ligne 2", "1");
    const t = conteneur.textContent ?? "";
    expect(t).toContain("21 000 FC"); // 3 × 7 000
    expect(t).toContain("sans prix");
    expect(t).toContain("incomplet : 1 ligne(s) sans prix");
    expect(t).toContain("≈ 7,50 $ au taux du jour (indicatif"); // l'autre devise, seulement en repère
    const tableau = conteneur.querySelector("table")!.textContent ?? "";
    expect(tableau).not.toContain("$");
  });

  it("changer de devise efface le prix saisi à la main (jamais réinterprété) et le dit", async () => {
    monter();
    await act(async () => { const d = conteneur.querySelectorAll<HTMLInputElement>('input[name="ligne_designation"]')[0]; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(d, "Libre"); d.dispatchEvent(new Event("input", { bubbles: true })); });
    await saisir("Prix unitaire, ligne 1", "12");
    expect(cachés("ligne_prix")[0]).toBe("12");
    await act(async () => bouton("Francs (FC)").click());
    expect(cachés("ligne_prix")[0]).toBe("");
    expect(conteneur.textContent).toContain("1 prix saisi(s) à la main effacé(s), à ressaisir en francs");
  });

  it("modification d'un bon en francs : le formulaire s'ouvre en francs, avec ses prix", () => {
    monter({ bcId: "b1", fournisseurId: "f1", devise: "CDF", delaiPaiement: "", modePaiement: "", commentaire: "", lignes: [{ articleId: "", designation: "Riz", quantite: "5", prix: "3000", uniteParCarton: "" }] });
    expect(cachés("devise")).toEqual(["CDF"]);
    expect(bouton("Francs (FC)").getAttribute("aria-pressed")).toBe("true");
    expect(cachés("ligne_prix")[0]).toBe("3000");
    expect(conteneur.textContent).toContain("15 000 FC");
  });
});

// @vitest-environment happy-dom
//
// Paramètres : créer un utilisateur / un type de congé. Un refus du serveur (email déjà pris, nom déjà utilisé)
// laisse la saisie en place ; une réussite vide le formulaire (audit du 10/10/2026, ergonomie 2).
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";

const m = vi.hoisted(() => ({
  creerUtilisateur: vi.fn<(fd: FormData) => Promise<unknown>>(async () => undefined),
  creerTypeConge: vi.fn<(fd: FormData) => Promise<unknown>>(async () => undefined),
}));
vi.mock("./user-actions", () => ({ creerUtilisateur: m.creerUtilisateur, definirRoleUtilisateur: vi.fn(), basculerActifUtilisateur: vi.fn(), reinitialiserMotDePasse: vi.fn(), lierUtilisateurEmploye: vi.fn() }));
vi.mock("./typeconge-actions", () => ({ creerTypeConge: m.creerTypeConge, modifierTypeConge: vi.fn(), basculerTypeConge: vi.fn(), supprimerTypeConge: vi.fn() }));

import { UsersAdmin } from "./users-admin";
import { TypesCongesAdmin } from "./types-conges-admin";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let conteneur: HTMLDivElement;
let racine: Root;
afterEach(() => { act(() => racine.unmount()); conteneur.remove(); vi.clearAllMocks(); });
function monter(el: ReturnType<typeof h>) {
  conteneur = document.createElement("div");
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine.render(el));
}
function saisir(el: HTMLInputElement, valeur: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, valeur);
  act(() => { el.dispatchEvent(new Event("input", { bubbles: true })); });
}
const champ = (nom: string) => conteneur.querySelector<HTMLInputElement>(`input[name="${nom}"]`)!;
const envoyer = async (form: HTMLFormElement) => { await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }); };

describe("UsersAdmin — création", () => {
  const el = () => h(UsersAdmin, { users: [], employes: [], monId: "u0" });
  it("refus : le message est affiché et le formulaire garde nom, email et mot de passe", async () => {
    m.creerUtilisateur.mockResolvedValueOnce({ erreur: "Cet email est déjà utilisé." });
    monter(el());
    saisir(champ("nom"), "Aimée Mutita");
    saisir(champ("email"), "aimee@example.cd");
    await envoyer(champ("nom").closest("form")!);
    expect(conteneur.textContent).toContain("Cet email est déjà utilisé.");
    expect(champ("nom").value).toBe("Aimée Mutita");
    expect(champ("email").value).toBe("aimee@example.cd");
  });
  it("réussite : le formulaire est vidé", async () => {
    monter(el());
    saisir(champ("nom"), "Aimée Mutita");
    await envoyer(champ("nom").closest("form")!);
    expect(m.creerUtilisateur).toHaveBeenCalledTimes(1);
    expect(champ("nom").value).toBe("");
  });
});

describe("TypesCongesAdmin — création", () => {
  it("refus : le nom saisi reste", async () => {
    m.creerTypeConge.mockResolvedValueOnce({ erreur: "Ce type existe déjà." });
    monter(h(TypesCongesAdmin, { types: [] }));
    saisir(champ("nom"), "Congé exceptionnel");
    await envoyer(champ("nom").closest("form")!);
    expect(conteneur.textContent).toContain("Ce type existe déjà.");
    expect(champ("nom").value).toBe("Congé exceptionnel");
  });
});

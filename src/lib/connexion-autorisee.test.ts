import { describe, it, expect } from "vitest";
import { connexionAutorisee } from "./connexion-autorisee";

// Audit du 10/10/2026, sécurité 10 : un salarié AVEC accès Stock était refusé à la connexion quand
// l'espace salarié était fermé (« Identifiants incorrects »), alors que le Stock lui est ouvert.
describe("connexionAutorisee", () => {
  const p = (role: "EMPLOYE" | "STOCK" | "ADMIN", actif = true, accesStock = false) => ({ role, actif, accesStock });

  it("salarié avec accès Stock, espace salarié FERMÉ : connexion autorisée", () => {
    expect(connexionAutorisee(p("EMPLOYE", true, true), false)).toBe(true);
  });
  it("salarié sans accès Stock, espace fermé : refusé ; espace ouvert : autorisé", () => {
    expect(connexionAutorisee(p("EMPLOYE"), false)).toBe(false);
    expect(connexionAutorisee(p("EMPLOYE"), true)).toBe(true);
  });
  it("compte désactivé : toujours refusé, même avec accès Stock", () => {
    expect(connexionAutorisee(p("EMPLOYE", false, true), true)).toBe(false);
    expect(connexionAutorisee(p("ADMIN", false), true)).toBe(false);
  });
  it("les autres rôles ne dépendent pas de l'espace salarié", () => {
    expect(connexionAutorisee(p("STOCK"), false)).toBe(true);
    expect(connexionAutorisee(p("ADMIN"), false)).toBe(true);
  });
});

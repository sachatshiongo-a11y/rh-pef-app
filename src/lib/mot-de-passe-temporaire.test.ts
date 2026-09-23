import { describe, it, expect } from "vitest";
import type { Role } from "@prisma/client";
import { peutChangerSonMotDePasse, formulaireMotDePasseOuvert, doitChangerSonMotDePasse } from "./mot-de-passe-temporaire";

// Le formulaire /espace/mot-de-passe ne demande pas l'ancien mot de passe et n'est pas journalisé.
// Ouvert à tout compte relié à une fiche, il laissait la Direction (ADMIN par e-mail) ou un compte
// Stock à e-mail changer son mot de passe sans l'ancien, à 6 caractères, sans trace.

const compte = (role: Role, o: { fiche?: boolean; temporaire?: boolean; ouvert?: boolean } = {}) => ({
  role,
  employeeId: o.fiche === false ? null : "emp-1",
  motDePasseTemporaire: o.temporaire ?? true,
  espaceOuvert: o.ouvert ?? true,
});

describe("peutChangerSonMotDePasse", () => {
  it("ADMIN relié à une fiche, mot de passe non temporaire : refusé", () => {
    expect(peutChangerSonMotDePasse(compte("ADMIN", { temporaire: false }))).toBe(false);
  });

  it("STOCK relié, mot de passe temporaire, espace ouvert : accepté", () => {
    expect(peutChangerSonMotDePasse(compte("STOCK"))).toBe(true);
  });

  it("STOCK relié, mot de passe temporaire, espace fermé : refusé", () => {
    expect(peutChangerSonMotDePasse(compte("STOCK", { ouvert: false }))).toBe(false);
  });

  it("STOCK relié à mot de passe déjà personnel, ou sans fiche : refusé", () => {
    expect(peutChangerSonMotDePasse(compte("STOCK", { temporaire: false }))).toBe(false);
    expect(peutChangerSonMotDePasse(compte("STOCK", { fiche: false }))).toBe(false);
  });

  it("aucun autre rôle n'y échappe : même règle pour MANAGER, VIEWER, COMPTA, ADMIN", () => {
    for (const role of ["ADMIN", "MANAGER", "VIEWER", "COMPTA"] as Role[]) {
      expect(peutChangerSonMotDePasse(compte(role)), role).toBe(true);
      expect(peutChangerSonMotDePasse(compte(role, { temporaire: false })), role).toBe(false);
      expect(peutChangerSonMotDePasse(compte(role, { ouvert: false })), role).toBe(false);
      expect(peutChangerSonMotDePasse(compte(role, { fiche: false })), role).toBe(false);
    }
  });

  it("EMPLOYE : inchangé, toujours accepté", () => {
    expect(peutChangerSonMotDePasse(compte("EMPLOYE", { temporaire: false, ouvert: false, fiche: false }))).toBe(true);
  });
});

describe("formulaireMotDePasseOuvert (la page)", () => {
  it("n'affiche pas le formulaire à un compte non EMPLOYE hors de la règle", () => {
    expect(formulaireMotDePasseOuvert(compte("ADMIN", { temporaire: false }))).toBe(false);
    expect(formulaireMotDePasseOuvert(compte("STOCK", { ouvert: false }))).toBe(false);
    expect(formulaireMotDePasseOuvert(compte("STOCK"))).toBe(true);
  });

  it("EMPLOYE : comme avant, espace ouvert et fiche liée", () => {
    expect(formulaireMotDePasseOuvert(compte("EMPLOYE", { temporaire: false }))).toBe(true);
    expect(formulaireMotDePasseOuvert(compte("EMPLOYE", { ouvert: false }))).toBe(false);
    expect(formulaireMotDePasseOuvert(compte("EMPLOYE", { fiche: false }))).toBe(false);
  });
});

describe("doitChangerSonMotDePasse (les gardes)", () => {
  it("un mot de passe temporaire envoie vers la page seulement si elle l'accueille : pas de boucle", () => {
    expect(doitChangerSonMotDePasse(compte("STOCK"))).toBe(true);
    expect(doitChangerSonMotDePasse(compte("EMPLOYE"))).toBe(true);
    expect(doitChangerSonMotDePasse(compte("STOCK", { ouvert: false }))).toBe(false);
    expect(doitChangerSonMotDePasse(compte("EMPLOYE", { ouvert: false }))).toBe(false);
    expect(doitChangerSonMotDePasse(compte("EMPLOYE", { fiche: false }))).toBe(false);
  });

  it("un mot de passe personnel n'envoie nulle part", () => {
    expect(doitChangerSonMotDePasse(compte("EMPLOYE", { temporaire: false }))).toBe(false);
    expect(doitChangerSonMotDePasse(compte("STOCK", { temporaire: false }))).toBe(false);
  });
});

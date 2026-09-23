import { describe, it, expect } from "vitest";
import { Role } from "@prisma/client";
import { ROLE_LIBELLE, ROLE_DESCRIPTION, ROLES_ATTRIBUABLES, roleModifiableIci } from "./roles";

describe("les rôles affichés", () => {
  it("chaque rôle de la BASE a un libellé et une description (sinon l'écran ment)", () => {
    for (const r of Object.values(Role)) {
      expect(ROLE_LIBELLE[r], `rôle ${r} sans libellé`).toBeTruthy();
      expect(ROLE_DESCRIPTION[r], `rôle ${r} sans description`).toBeTruthy();
    }
  });
  it("un compte salarié n'est jamais « Direction »", () => {
    expect(ROLE_LIBELLE.EMPLOYE).toBe("Salarié");
    expect(ROLE_LIBELLE.EMPLOYE).not.toBe(ROLE_LIBELLE.ADMIN);
  });
  it("seuls les 4 rôles de gestion se modifient depuis Utilisateurs & accès", () => {
    expect([...ROLES_ATTRIBUABLES]).toEqual(["ADMIN", "MANAGER", "VIEWER", "STOCK"]);
    expect(roleModifiableIci("EMPLOYE")).toBe(false);
    expect(roleModifiableIci("COMPTA")).toBe(false);
    expect(roleModifiableIci("STOCK")).toBe(true);
  });
});

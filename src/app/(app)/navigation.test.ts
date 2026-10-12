import { describe, it, expect } from "vitest";
import { BARRE_DU_BAS, NAV_GROUPS } from "./navigation";
import { choisirBarreDuBas } from "@/lib/navigation-espaces";

// Le menu de l'espace RH, tel que le plan d'ergonomie du 2026-10-12 le fixe (§3.1, V2) : l'ORDRE des groupes et
// des entrées est figé ici. Un déplacement se décide, il ne se fait pas par accident.
describe("menu RH — groupes et ordre (plan d'ergonomie §3.1)", () => {
  it("six groupes, dans l'ordre : Pilotage, Équipe, Paie, Temps de travail, Archives, Configuration", () => {
    expect(NAV_GROUPS.map((g) => g.titre)).toEqual(["Pilotage", "Équipe", "Paie", "Temps de travail", "Archives", "Configuration"]);
  });

  it("chaque groupe porte ses entrées dans l'ordre voulu (libellé → adresse)", () => {
    expect(NAV_GROUPS.map((g) => g.items.map((i) => `${i.label} → ${i.href}`))).toEqual([
      ["Accueil → /accueil", "À valider → /a-valider"],
      ["Employés → /employes", "Fiches de poste → /fiches-poste"],
      ["Paie → /paie", "Déclarations → /declarations"],
      ["Planning → /planning", "Présences & heures → /presences", "Congés & absences → /conges", "Pointages → /pointer"],
      ["Documents & archives → /documents"],
      ["Paramètres → /parametres"],
    ]);
  });

  it("« À valider » est la 2e ligne du menu et visible par tous les rôles (aucune entrée réservée à la Direction)", () => {
    const toutes = NAV_GROUPS.flatMap((g) => g.items);
    expect(toutes[1].href).toBe("/a-valider");
    expect(toutes.filter((i) => i.adminOnly)).toEqual([]);
  });

  it("aucune adresse n'a changé : « Pointages » garde /pointer, et chaque adresse n'apparaît qu'une fois", () => {
    const adresses = NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href));
    expect(new Set(adresses).size).toBe(adresses.length);
    expect(adresses).toContain("/pointer");
  });

  it("la barre du bas ne change pas : Accueil · Présences · Planning · À valider (Direction) ou Congés", () => {
    expect(choisirBarreDuBas(NAV_GROUPS, BARRE_DU_BAS, "ADMIN").map((e) => e.court)).toEqual(["Accueil", "Présences", "Planning", "À valider"]);
    expect(choisirBarreDuBas(NAV_GROUPS, BARRE_DU_BAS, "MANAGER").map((e) => e.court)).toEqual(["Accueil", "Présences", "Planning", "Congés"]);
    expect(choisirBarreDuBas(NAV_GROUPS, BARRE_DU_BAS, "VIEWER").map((e) => e.court)).toEqual(["Accueil", "Présences", "Planning", "Congés"]);
  });
});

import { describe, it, expect } from "vitest";
import { choisirBarreDuBas, entreesVisibles, type GroupeMenu } from "./navigation-espaces";

const GROUPES: GroupeMenu[] = [
  { titre: "A", items: [
    { href: "/accueil", label: "Tableau de bord", icone: "accueil" },
    { href: "/a-valider", label: "Demandes", icone: "valider", adminOnly: true },
  ] },
  { titre: "B", items: [
    { href: "/presences", label: "Présences", icone: "presence" },
    { href: "/planning", label: "Planning", icone: "calendrier" },
    { href: "/conges", label: "Congés", icone: "parasol" },
  ] },
];
const CANDIDATS = [
  { href: "/accueil", court: "Accueil" },
  { href: "/presences", court: "Présences" },
  { href: "/planning", court: "Planning" },
  { href: "/a-valider", court: "À valider" },
  { href: "/conges", court: "Congés" },
];

describe("choix de la barre du bas", () => {
  it("Direction : les quatre premiers candidats, icône prise dans le menu, badges reportés", () => {
    expect(choisirBarreDuBas(GROUPES, CANDIDATS, "ADMIN", { "/a-valider": 3 })).toEqual([
      { href: "/accueil", icone: "accueil", court: "Accueil", badge: 0 },
      { href: "/presences", icone: "presence", court: "Présences", badge: 0 },
      { href: "/planning", icone: "calendrier", court: "Planning", badge: 0 },
      { href: "/a-valider", icone: "valider", court: "À valider", badge: 3 },
    ]);
  });

  it("un rôle qui ne voit pas une entrée « Direction » reçoit le candidat suivant, pas un trou", () => {
    expect(choisirBarreDuBas(GROUPES, CANDIDATS, "MANAGER").map((e) => e.href)).toEqual(["/accueil", "/presences", "/planning", "/conges"]);
  });

  it("un candidat absent du menu est ignoré (jamais un lien mort)", () => {
    expect(choisirBarreDuBas(GROUPES, [{ href: "/inconnu", court: "?" }, ...CANDIDATS], "ADMIN").map((e) => e.href)).not.toContain("/inconnu");
  });

  it("entrées visibles du menu : les entrées « Direction » masquées aux autres rôles", () => {
    expect(entreesVisibles(GROUPES[0].items, "VIEWER").map((i) => i.href)).toEqual(["/accueil"]);
    expect(entreesVisibles(GROUPES[0].items, "ADMIN")).toHaveLength(2);
  });
});

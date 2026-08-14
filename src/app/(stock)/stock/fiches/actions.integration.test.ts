import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Garde-fous des actions « fiches techniques » : ce sont eux qui empêchent d'écrire en base une
// ligne dont le coût serait ensuite indéterminé ou faux (article ET sous-recette, fiche qui se
// contient, rendement à moitié saisi, suppression d'une sous-recette encore utilisée).
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
const A = vi.hoisted(() => ({ user: { id: "seed", role: "ADMIN", nom: "Testeur" } }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));
vi.mock("@/lib/auth", () => ({ verifySession: async () => A.user, requireModule: () => {}, requireRole: () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const { creerFiche, modifierFiche, supprimerFiches, dupliquerFiches, ajouterIngredient, supprimerIngredients } = await import("./actions");

let prisma: PrismaClient;
let fermer: () => Promise<void>;

/** Petit utilitaire : un FormData depuis un objet. */
const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const erreurDe = (r: unknown): string => {
  if (typeof r === "object" && r !== null && "erreur" in r) return String((r as { erreur: string }).erreur);
  throw new Error("Action acceptée alors qu'elle aurait dû être refusée.");
};
const ok = <T,>(r: T | { erreur: string }): T => {
  if (typeof r === "object" && r !== null && "erreur" in r) throw new Error(String((r as { erreur: string }).erreur));
  return r as T;
};

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  const u = await prisma.user.create({ data: { email: "fiches@pef.cd", nom: "T", role: "ADMIN" } });
  A.user.id = u.id;
}, 120_000);

afterAll(async () => { await fermer?.(); });

describe("actions fiches techniques", () => {
  it("crée une fiche et refuse un nom vide", async () => {
    const r = ok(await creerFiche(fd({ nom: "Bolognaise", categorie: "Pâtes classiques", nbPortions: "1" })));
    expect(r.id).toBeTruthy();
    expect(erreurDe(await creerFiche(fd({ nom: "   " })))).toContain("nom");
  }, 60_000);

  it("un ingrédient est un article XOR une sous-recette — jamais les deux, jamais aucun", async () => {
    const f = ok(await creerFiche(fd({ nom: "XOR", nbPortions: "1" })));
    const art = await prisma.articleStock.create({ data: { designation: "Penne", domaine: "NOURRITURE", unite: "kg", prixUnitaireUSD: "0.35" } });
    const sous = ok(await creerFiche(fd({ nom: "Sauce XOR", nbPortions: "1", estSousRecette: "on" })));

    expect(erreurDe(await ajouterIngredient(f.id, fd({ articleId: art.id, sousFicheId: sous.id, unite: "g", quantite: "10" }))))
      .toContain("jamais les deux");
    expect(erreurDe(await ajouterIngredient(f.id, fd({ articleId: "", sousFicheId: "", unite: "g", quantite: "10" }))))
      .toContain("Choisissez");
    expect(await prisma.ingredientFiche.count({ where: { ficheId: f.id } })).toBe(0);

    ok(await ajouterIngredient(f.id, fd({ articleId: art.id, unite: "kg", quantite: "0.2" })));
    expect(await prisma.ingredientFiche.count({ where: { ficheId: f.id } })).toBe(1);
  }, 60_000);

  it("refuse qu'une fiche se contienne elle-même (cycle direct)", async () => {
    const f = ok(await creerFiche(fd({ nom: "Auto-référence", nbPortions: "1" })));
    expect(erreurDe(await ajouterIngredient(f.id, fd({ sousFicheId: f.id, unite: "g", quantite: "10" }))))
      .toContain("ne peut pas se contenir elle-même");
    expect(await prisma.ingredientFiche.count({ where: { ficheId: f.id } })).toBe(0);
  }, 60_000);

  it("refuse une quantité nulle ou négative et une unité vide", async () => {
    const f = ok(await creerFiche(fd({ nom: "Quantités", nbPortions: "1" })));
    const art = await prisma.articleStock.create({ data: { designation: "Sel", domaine: "NOURRITURE", unite: "kg", prixUnitaireUSD: "1" } });
    expect(erreurDe(await ajouterIngredient(f.id, fd({ articleId: art.id, unite: "g", quantite: "0" })))).toContain("quantité");
    expect(erreurDe(await ajouterIngredient(f.id, fd({ articleId: art.id, unite: "g", quantite: "-3" })))).toContain("quantité");
    expect(erreurDe(await ajouterIngredient(f.id, fd({ articleId: art.id, unite: " ", quantite: "3" })))).toContain("unité");
    expect(await prisma.ingredientFiche.count({ where: { ficheId: f.id } })).toBe(0);
  }, 60_000);

  it("refuse un rendement à moitié saisi (quantité sans unité) — l'erreur d'échelle silencieuse", async () => {
    const f = ok(await creerFiche(fd({ nom: "Sauce sans unité", nbPortions: "1", estSousRecette: "on" })));
    const base = { nom: "Sauce sans unité", nbPortions: "1", tauxTVA: "0.16", estSousRecette: "on", actif: "on" };
    expect(erreurDe(await modifierFiche(f.id, fd({ ...base, rendementQuantite: "4600" })))).toContain("unité du rendement");
    expect(erreurDe(await modifierFiche(f.id, fd({ ...base, rendementUnite: "g" })))).toContain("quantité du rendement");
    ok(await modifierFiche(f.id, fd({ ...base, rendementQuantite: "4600", rendementUnite: "g" })));
    const maj = await prisma.ficheTechnique.findUniqueOrThrow({ where: { id: f.id } });
    expect(Number(maj.rendementQuantite)).toBe(4600);
    expect(maj.rendementUnite).toBe("g");
  }, 60_000);

  it("une sous-recette n'exige aucun prix de vente ; la TVA se saisit en décimal", async () => {
    const f = ok(await creerFiche(fd({ nom: "Sous-recette sans prix", nbPortions: "1", estSousRecette: "on" })));
    const base = { nom: "Sous-recette sans prix", nbPortions: "1", tauxTVA: "0.16", estSousRecette: "on", actif: "on" };
    ok(await modifierFiche(f.id, fd(base))); // ni prix de vente ni coefficient : accepté
    expect(erreurDe(await modifierFiche(f.id, fd({ ...base, tauxTVA: "16" })))).toContain("0,16 pour 16 %");
    expect(erreurDe(await modifierFiche(f.id, fd({ ...base, nbPortions: "0" })))).toContain("portions");
  }, 60_000);

  it("refuse de supprimer une sous-recette utilisée ailleurs, l'accepte si le plat part dans le même lot", async () => {
    const sauce = ok(await creerFiche(fd({ nom: "Sauce utilisée", nbPortions: "1", estSousRecette: "on" })));
    const plat = ok(await creerFiche(fd({ nom: "Plat qui l'utilise", nbPortions: "1" })));
    ok(await ajouterIngredient(plat.id, fd({ sousFicheId: sauce.id, unite: "g", quantite: "200" })));

    const refus = erreurDe(await supprimerFiches([sauce.id]));
    expect(refus).toContain("Sauce utilisée");
    expect(refus).toContain("Plat qui l'utilise");
    expect(await prisma.ficheTechnique.count({ where: { id: sauce.id } })).toBe(1);

    // Les deux ensemble : la ligne du plat disparaît en cascade, plus rien ne bloque.
    ok(await supprimerFiches([sauce.id, plat.id]));
    expect(await prisma.ficheTechnique.count({ where: { id: { in: [sauce.id, plat.id] } } })).toBe(0);
  }, 60_000);

  it("duplique une fiche avec ses ingrédients", async () => {
    const f = ok(await creerFiche(fd({ nom: "À dupliquer", categorie: "Pizzas", nbPortions: "2" })));
    const art = await prisma.articleStock.create({ data: { designation: "Mozzarella", domaine: "NOURRITURE", unite: "kg", prixUnitaireUSD: "6" } });
    ok(await ajouterIngredient(f.id, fd({ articleId: art.id, unite: "g", quantite: "150" })));

    const r = ok(await dupliquerFiches([f.id]));
    const copie = await prisma.ficheTechnique.findUniqueOrThrow({ where: { id: r.ids[0] }, include: { ingredients: true } });
    expect(copie.nom).toBe("À dupliquer (copie)");
    expect(copie.categorie).toBe("Pizzas");
    expect(copie.nbPortions).toBe(2);
    expect(copie.ingredients).toHaveLength(1);
    expect(copie.ingredients[0].articleId).toBe(art.id);
    expect(Number(copie.ingredients[0].quantite)).toBe(150);
  }, 60_000);

  it("supprime des ingrédients en lot, et seulement ceux de la fiche visée", async () => {
    const f1 = ok(await creerFiche(fd({ nom: "Lot 1", nbPortions: "1" })));
    const f2 = ok(await creerFiche(fd({ nom: "Lot 2", nbPortions: "1" })));
    const art = await prisma.articleStock.create({ data: { designation: "Basilic", domaine: "NOURRITURE", unite: "kg", prixUnitaireUSD: "12" } });
    ok(await ajouterIngredient(f1.id, fd({ articleId: art.id, unite: "g", quantite: "5" })));
    ok(await ajouterIngredient(f1.id, fd({ articleId: art.id, unite: "g", quantite: "7" })));
    ok(await ajouterIngredient(f2.id, fd({ articleId: art.id, unite: "g", quantite: "9" })));

    const lignes1 = await prisma.ingredientFiche.findMany({ where: { ficheId: f1.id } });
    const ligne2 = await prisma.ingredientFiche.findFirstOrThrow({ where: { ficheId: f2.id } });

    // L'identifiant d'une autre fiche est ignoré : on ne supprime jamais chez le voisin.
    ok(await supprimerIngredients(f1.id, [...lignes1.map((l) => l.id), ligne2.id]));
    expect(await prisma.ingredientFiche.count({ where: { ficheId: f1.id } })).toBe(0);
    expect(await prisma.ingredientFiche.count({ where: { ficheId: f2.id } })).toBe(1);
  }, 60_000);
});

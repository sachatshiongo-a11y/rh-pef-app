import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

/**
 * Audit RESTAURANT du 10/10/2026, de la base aux exports de la Conso. journalière : l'unité du
 * catalogue sur chaque ligne (Commande, Consommation, Comparaison), le consommé de plusieurs jours en
 * « ≈ depuis le … », et — fiche « Commande » — une commande de légumes en Kg et un achat en Sac
 * jamais sur la même ligne.
 */
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));

const { donneesJournalier } = await import("./export-data");
const { chargerCommandesJournalieres } = await import("./fiches-data");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
const le = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const SEMAINE = "semaine=2026-10-05";

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  const farine = await prisma.articleStock.create({ data: { designation: "Farine", domaine: "NOURRITURE", unite: "kg" } });
  const vin = await prisma.articleStock.create({ data: { designation: "Vin rouge", domaine: "BOISSON", unite: "Bouteille" } });
  const sel = await prisma.articleStock.create({ data: { designation: "Sel", domaine: "NOURRITURE", unite: null } });
  const sortie = (articleId: string, quantite: number, date: string) => prisma.mouvementStock.create({ data: { articleId, type: "SORTIE", categorieSortie: "LIVRAISON_RESTAURANT", quantite, date: le(date) } });
  await sortie(farine.id, 10, "2026-10-05"); await sortie(vin.id, 5, "2026-10-05"); await sortie(sel.id, 1, "2026-10-05");
  await prisma.commandeResto.createMany({ data: [{ articleId: farine.id, date: le("2026-10-05"), quantite: 10 }, { articleId: vin.id, date: le("2026-10-05"), quantite: 5 }] });
  // Farine au restaurant : comptée le 02/10, puis le 06/10 (veille 05 non comptée), puis le 07/10.
  const rf = await prisma.articleResto.create({ data: { espace: "CUISINE", designation: "Farine", unite: "kg", ordre: 1, articleStockId: farine.id } });
  for (const [d, q] of [["2026-10-02", 20], ["2026-10-06", 14], ["2026-10-07", 13]] as const) await prisma.comptageResto.create({ data: { articleRestoId: rf.id, date: le(d), quantite: q } });
  // Légumes : commande en Kg (unité de la liste), achat en Sac le même jour.
  await prisma.commandeLegumeResto.create({ data: { legume: "Ail", date: le("2026-10-05"), quantite: 5 } });
  await prisma.achatLegume.createMany({ data: [
    { legume: "Ail", unite: "Sac", date: le("2026-10-05"), quantite: 2 },
    { legume: "Menthe", unite: "Botte", date: le("2026-10-05"), quantite: 3 },
  ] });
  await prisma.commandeLegumeResto.create({ data: { legume: "Menthe", date: le("2026-10-05"), quantite: 2 } });
}, 120_000);
afterAll(async () => { await fermer?.(); });

const noms = (d: { lignes: (string | number)[][] }) => d.lignes.map((l) => String(l[0]));

describe("exports de la Conso. journalière : l'unité sur chaque ligne", () => {
  it("Commande : « Farine (kg) », « Vin rouge (Bouteille) », « Sel » (unité non renseignée : le nom seul), légumes avec leur unité de liste", async () => {
    const d = await donneesJournalier(new URLSearchParams(`vue=commande&${SEMAINE}`));
    expect(noms(d)).toEqual(expect.arrayContaining(["Farine (kg)", "Vin rouge (Bouteille)", "Ail (Kg)", "Menthe (Botte)"]));
  });

  it("Consommation : livré avec son unité ; légumes par ligne (légume, unité) ; consommé « ≈ … depuis le 02/10 (4 jours) »", async () => {
    const d = await donneesJournalier(new URLSearchParams(`vue=conso&${SEMAINE}`));
    expect(noms(d)).toEqual(expect.arrayContaining(["Farine (kg)", "Vin rouge (Bouteille)", "Sel", "Ail (Sac)", "Menthe (Botte)"]));
    const consoFarine = d.lignes.filter((l) => l[0] === "Farine (kg)").at(-1)!; // la ligne de consommation réelle (la 1re est la livraison)
    // Mardi : 20 compté le 02/10 + 10 livrés le 05/10 − 14 compté le 06/10 = 16 kg sur 4 jours (la veille n'est pas comptée) ; mercredi : 14 − 13 = 1 kg.
    expect(consoFarine.slice(1, 4)).toEqual(["—", "≈ 16 depuis le 02/10 (4 jours)", "1"]);
  });

  it("Comparaison : l'unité sur l'article, l'achat en Sac sur SA ligne sans commande, le consommé de plusieurs jours en « ≈ »", async () => {
    const d = await donneesJournalier(new URLSearchParams(`vue=comparaison&${SEMAINE}`));
    expect(noms(d)).toEqual(expect.arrayContaining(["Farine (kg)", "Vin rouge (Bouteille)", "Ail (Kg)", "Ail (Sac)", "Menthe (Botte)"]));
    const ligne = (nom: string) => d.lignes.find((l) => l[0] === nom)!;
    // Colonnes d'un jour : Cmd, Livré, Conso (lundi = 1 à 3).
    expect(ligne("Ail (Kg)").slice(1, 4)).toEqual(["5", "", "—"]); // commandé 5 kg, rien acheté en kg
    expect(ligne("Ail (Sac)").slice(1, 4)).toEqual(["", "2", "—"]); // acheté 2 sacs, jamais comparé à des kg
    expect(ligne("Menthe (Botte)").slice(1, 4)).toEqual(["2", "3", "—"]);
    expect(ligne("Farine (kg)").slice(1, 4)).toEqual(["10", "10", "—"]);
    expect(ligne("Farine (kg)").slice(4, 7)).toEqual(["", "", "≈ 16"]); // mardi
  });
});

describe("fiche « Commande » du jour : légumes", () => {
  it("la commande en Kg et l'achat en Sac sont sur deux lignes ; la menthe (même unité) sur une seule", async () => {
    const { fiches } = await chargerCommandesJournalieres("2026-10-05", ["CUISINE"]);
    const legumes = fiches[0]!.sections.find((s) => s.titre === "Fruits & Légumes frais")!.lignes;
    const cases = (nom: string) => legumes.filter((l) => l.designation === nom).map((l) => l.cases.map((c) => c.valeur));
    // Colonnes cuisine : Unité | Commande | Livraison.
    expect(cases("Ail")).toEqual([["Kg", 5, ""], ["Sac", "", 2]]);
    expect(cases("Menthe")).toEqual([["Botte", 2, 3]]);
  });
});

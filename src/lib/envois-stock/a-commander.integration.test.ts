import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { creerBaseTest } from "@/lib/test/db";
import type { Espion } from "@/lib/test/espion-ecritures";

// Test d'INTÉGRATION (Postgres éphémère, jamais la prod) — rubrique « Articles à commander » du courriel du matin
// (Direction, 2026-10-18) : sorties lues sur la bonne période, regroupement par fournisseur habituel, articles écartés
// (un seul jour de sortie, dormant à 0, désactivé, déjà sur un bon en cours), rupture en tête, aucune écriture.
const E = vi.hoisted(() => ({ espion: undefined as unknown as Espion }));
vi.mock("@/lib/prisma", async () => {
  const { creerEspion, proxyEspion } = await import("@/lib/test/espion-ecritures");
  E.espion = creerEspion();
  return { prisma: proxyEspion(E.espion) };
});

const { rubriqueACommander, preparerEnvoiQuotidien } = await import("./quotidien");

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
// Jeudi 15 octobre 2026, 07 h à Kinshasa : période observée du 17/09 au 14/10 (aujourd'hui exclu).
const MATIN = new Date("2026-10-15T06:00:00Z");
const norm = (s: string) => s.replace(/[\s  ]+/g, " ");
let fermer: () => Promise<void>;
const ids: Record<string, string> = {};

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(MATIN);
  const db = await creerBaseTest();
  fermer = db.fermer; E.espion.client = db.prisma;
  const p = db.prisma;
  await p.config.create({ data: { id: "singleton", tauxChangeCDF: 2800, anneeCourante: 2026, moisCourant: 10 } });

  const regal = await p.fournisseur.create({ data: { nom: "Regal", delaiLivraison: "1 jour(s)" } });
  const cave = await p.fournisseur.create({ data: { nom: "Cave", delaiLivraison: "7" } });
  ids.regal = regal.id;

  const article = async (cle: string, designation: string, q: string, fournisseurId?: string, extra: Record<string, unknown> = {}) => {
    const a = await p.articleStock.create({ data: { designation, domaine: "NOURRITURE", unite: "kg", ...extra } });
    await p.stock.create({ data: { articleId: a.id, quantite: q, stockMinimum: 0 } });
    if (fournisseurId) await p.articleFournisseur.create({ data: { articleId: a.id, fournisseurId, habituel: true } });
    ids[cle] = a.id;
  };
  const sortie = (cle: string, quantite: number, jour: string) => p.mouvementStock.create({ data: { articleId: ids[cle]!, type: "SORTIE", quantite, date: d(jour) } });
  const quatreJours = async (cle: string) => { for (const j of ["2026-09-20", "2026-09-30", "2026-10-05", "2026-10-14"]) await sortie(cle, 7, j); }; // 28 → 1 kg/jour

  await article("creme", "Crème", "2", regal.id); await quatreJours("creme"); // rupture 17/10, livraison 1 j → avant le 16/10 (demain)
  await article("vin", "Vin", "10", cave.id); await quatreJours("vin"); // rupture 25/10, livraison 7 j → avant le 18/10 (dans 3 j)
  await article("sucre", "Sucre", "100", regal.id); await quatreJours("sucre"); // loin : absent
  await article("sel", "Sel", "1"); await sortie("sel", 7, "2026-10-01"); await sortie("sel", 7, "2026-10-10"); // 0,5/j, sans fournisseur → avant le 17/10
  await article("unique", "Piment", "1", regal.id); await sortie("unique", 10, "2026-10-12"); // un seul jour de sortie : absent
  await article("farine", "Farine", "0", regal.id); await quatreJours("farine"); // à 0 et consommée : EN RUPTURE, en tête
  await article("dormant", "Safran", "0", regal.id); // à 0, jamais sorti : absent
  await article("ancien", "Ancien sirop", "1", regal.id, { actif: false }); await quatreJours("ancien"); // désactivé : absent
  await article("huile", "Huile", "1", regal.id); await quatreJours("huile"); // déjà commandée : absente
  // Jus : 0,1 kg/j sur la période (largement couvert) ; la grosse sortie d'AUJOURD'HUI et celle d'avant la période ne comptent pas.
  await article("jus", "Jus", "5", regal.id); await sortie("jus", 1.4, "2026-09-25"); await sortie("jus", 1.4, "2026-10-08");
  await sortie("jus", 500, "2026-10-15"); await sortie("jus", 500, "2026-09-10");

  await p.bonDeCommande.create({
    data: {
      numero: "001/PEF/OCT/26", sequence: 1, annee: 2026, mois: 10, date: d("2026-10-13"), statut: "VALIDE", fournisseurId: regal.id,
      lignes: { create: [{ designation: "Huile", articleId: ids.huile!, quantite: 10 }] },
    },
  });
  // Un bon REÇU ne retient rien : la crème reste à commander.
  await p.bonDeCommande.create({
    data: {
      numero: "002/PEF/OCT/26", sequence: 2, annee: 2026, mois: 10, date: d("2026-10-01"), statut: "RECU", fournisseurId: regal.id,
      lignes: { create: [{ designation: "Crème", articleId: ids.creme!, quantite: 10, quantiteRecue: 10 }] },
    },
  });
}, 180_000);

afterAll(async () => { vi.useRealTimers(); await fermer?.(); });

const texte = (r: { groupes: { titre?: string; lignes: { texte: string }[] }[] }) => r.groupes.flatMap((g) => [g.titre ?? "", ...g.lignes.map((l) => l.texte)]).map(norm).join("\n");

describe("rubrique « Articles à commander »", () => {
  it("retient la farine (rupture), la crème, le vin et le sel, avec la date limite, le délai et la quantité suggérée", async () => {
    const r = (await rubriqueACommander(MATIN))!;
    const t = texte(r);
    expect(r.nombre).toBe(4);
    expect(t).toContain("Farine — EN RUPTURE (stock 0 kg) · 1 kg/jour · livraison 1 j · à commander AUJOURD'HUI · suggéré : 15 kg");
    expect(t).toContain("Crème — stock 2 kg · 1 kg/jour · rupture vers le 17/10/2026 · livraison 1 j · à commander avant le 16/10/2026 (demain) · suggéré : 13 kg");
    expect(t).toContain("Vin — stock 10 kg · 1 kg/jour · rupture vers le 25/10/2026 · livraison 7 j · à commander avant le 18/10/2026 (dans 3 j) · suggéré : 11 kg");
    expect(t).toContain("Sel — stock 1 kg · 0,5 kg/jour · rupture vers le 17/10/2026 · délai de livraison non renseigné (compté 0 j) · à commander avant le 17/10/2026 (dans 2 j) · suggéré : 6 kg");
    for (const absent of ["Sucre", "Piment", "Safran", "Ancien sirop", "Huile", "Jus"]) expect(t).not.toContain(absent);
  });

  it("un groupe par fournisseur habituel, le plus pressé d'abord, « Sans fournisseur habituel » en dernier", async () => {
    const r = (await rubriqueACommander(MATIN))!;
    expect(r.groupes.map((g) => g.titre)).toEqual(["Regal (2)", "Cave (1)", "Sans fournisseur habituel (1)"]);
    // La rupture passe avant la date limite la plus proche.
    expect(r.groupes[0]!.lignes.map((l) => l.lien)).toEqual([`/stock/catalogue/${ids.farine}`, `/stock/catalogue/${ids.creme}`]);
  });

  it("le résumé dit la règle, les articles écartés parce que déjà commandés, et la limite des saisies", async () => {
    const r = (await rubriqueACommander(MATIN))!;
    expect(r.resume).toContain("4 article(s), dont 1 déjà en rupture, par fournisseur habituel.");
    expect(r.resume).toContain("déjà sur un bon de commande en cours (1)");
    expect(r.resume).toContain("Fiable seulement si les sorties et les réceptions sont saisies chaque jour.");
  });

  it("prend place dans le courriel du matin, juste après les alertes de seuil", async () => {
    const e = (await preparerEnvoiQuotidien(MATIN))!;
    expect(e.rubriques.map((r) => r.cle)).toContain("a-commander");
    expect(e.corps).toContain("ARTICLES À COMMANDER D'ICI 3 JOURS — 4");
  });

  it("n'écrit rien", async () => {
    E.espion.actif = true; E.espion.refus = [];
    await rubriqueACommander(MATIN);
    E.espion.actif = false;
    expect(E.espion.refus).toEqual([]);
  });
});

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import ExcelJS from "exceljs";
import { creerBaseTest } from "@/lib/test/db";

// Export « Inventaire + mouvements » de la Clôture du mois (Excel ; le PDF est retiré depuis le 13/10/2026) : 12/10/2026, la Direction ne recevait
// que « Le document n'a pas pu être récupéré ». Test d'INTÉGRATION (Postgres éphémère) qui appelle le vrai GET,
// sur un mois non clôturé (état actuel) et un mois clôturé (instantané figé), avec des articles qui ont une
// marque, une contenance, un prix en francs, un fournisseur, et des mouvements de chaque type.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient, panne: false, lecturesMouvements: 0 }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      if (H.panne && p === "articleStock") return { findMany: async () => { throw new Error("connexion à la base perdue (essai)"); } };
      if (p === "mouvementStock") {
        const m = (H.client as unknown as { mouvementStock: { findMany: (a: unknown) => Promise<unknown[]> } }).mouvementStock;
        return new Proxy(m, { get: (t, q) => q === "findMany" ? async (a: unknown) => { H.lecturesMouvements++; return t.findMany(a); } : (t as never)[q] });
      }
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));
vi.mock("@/lib/garde-route", () => ({ exigerEspaceStock: async () => ({ ok: true, user: { id: "u1", nom: "Sacha", role: "ADMIN" } }) }));

const { GET } = await import("./route");
const { snapshotActuel, PLAFOND_MOUVEMENTS_EXPORT } = await import("@/lib/cloture-inventaire");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
const J = (iso: string) => new Date(`${iso}T00:00:00Z`);
const appel = (mois: string, format: string) => GET(new Request(`http://localhost/stock/cloture/inventaire?mois=${mois}&format=${format}`));

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  await prisma.user.create({ data: { id: "u1", email: "u1@pef.cd", nom: "Sacha", role: "ADMIN" } });
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2800, anneeCourante: 2026, moisCourant: 10 } });
  const cat = await prisma.categorieStock.create({ data: { nom: "Épicerie", domaine: "NOURRITURE" } });
  const f = await prisma.fournisseur.create({ data: { nom: "Fourn" } });
  const defs = [
    { designation: "Vodka", marque: "Absolut", domaine: "BOISSON" as const, contenance: "70", contenanceUnite: "cl", prixUnitaireUSD: "12.5" },
    { designation: "Beurre", marque: "Président", domaine: "NOURRITURE" as const, contenance: "250", contenanceUnite: "g", prixUnitaireUSD: "3" },
    { designation: "Farine", marque: null, domaine: "NOURRITURE" as const, contenance: null, contenanceUnite: null, prixUnitaireUSD: null },
    // Prix saisi en FRANCS ; et le domaine « Autre » reste VIDE (feuille sans article ni mouvement).
    { designation: "Sucre", marque: null, domaine: "NOURRITURE" as const, contenance: null, contenanceUnite: null, prixUnitaireUSD: null, devisePrix: "CDF" as const, prixUnitaireCDF: "7000" },
  ];
  for (const [i, d] of defs.entries()) {
    const a = await prisma.articleStock.create({ data: { ...d, code: String(i + 1), unite: "kg", categorieId: cat.id, fournisseurId: f.id } });
    await prisma.stock.create({ data: { articleId: a.id, quantite: i === 2 ? "4" : "10", stockMinimum: "5", seuilUrgent: "2" } });
    for (const [j, type] of (["ENTREE", "SORTIE", "ENTREE"] as const).entries()) {
      for (const mois of ["07", "08", "09"]) {
        await prisma.mouvementStock.create({ data: { articleId: a.id, type, quantite: "2.5", date: J(`2026-${mois}-${String(j + 3).padStart(2, "0")}`), montantUSD: i === 2 ? null : "7.5" } });
      }
    }
  }
  // Août est CLÔTURÉ (instantané figé) ; juillet et septembre ne le sont pas.
  await prisma.clotureStock.create({ data: { annee: 2026, mois: 8, snapshot: JSON.parse(JSON.stringify(await snapshotActuel())) } });
}, 120_000);
afterAll(async () => { await fermer?.(); });

describe("GET /stock/cloture/inventaire", () => {
  for (const [mois, etat] of [["2026-9", "non clôturé"], ["2026-8", "clôturé"]] as const) {
    it(`Excel — mois ${etat} : un vrai classeur, une feuille par domaine`, async () => {
      const res = await appel(mois, "excel");
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toContain("spreadsheetml");
      const buf = Buffer.from(await res.arrayBuffer());
      expect(buf.subarray(0, 2).toString()).toBe("PK");
    }, 120_000);
  }

  it("PDF retiré (13/10/2026) : 410 en texte lisible qui renvoie vers l'Excel, sans lire la base ; l'Excel lit les mouvements une fois", async () => {
    H.lecturesMouvements = 0;
    for (const mois of ["2026-9", "2026-8", "n'importe quoi"]) {
      const res = await appel(mois, "pdf");
      expect(res.status).toBe(410);
      expect(res.headers.get("Content-Type")).toMatch(/^text\/plain/);
      expect(await res.text()).toBe("L'inventaire se télécharge en Excel.");
    }
    expect(H.lecturesMouvements).toBe(0);
    await (await appel("2026-9", "excel")).arrayBuffer();
    expect(H.lecturesMouvements).toBe(1);
  }, 120_000);

  it("une panne se DIT : 500 en texte avec une référence, la cause va au journal du serveur (jamais à l'écran)", async () => {
    const erreur = vi.spyOn(console, "error").mockImplementation(() => {});
    H.panne = true;
    try {
      for (const format of ["excel"]) {
        const res = await appel("2026-9", format);
        expect(res.status).toBe(500);
        expect(res.headers.get("Content-Type")).toMatch(/^text\/plain/);
        const texte = await res.text();
        expect(texte).toMatch(/référence INV-[0-9A-Z]+/);
        expect(texte.length).toBeLessThanOrEqual(300); // sinon l'écran retombe sur la phrase « vérifiez votre connexion »
        expect(texte).not.toMatch(/connexion à la base perdue/);
        const ref = texte.match(/INV-[0-9A-Z]+/)![0];
        expect(erreur.mock.calls.some((c) => String(c[0]).includes(ref) && c.some((x) => x instanceof Error && /base perdue/.test(x.message)))).toBe(true);
      }
    } finally { H.panne = false; erreur.mockRestore(); }
  }, 120_000);

  it("un mois de plus de 8 000 mouvements : l'Excel DIT que la liste est coupée (jamais en silence)", async () => {
    const a = await prisma.articleStock.findFirstOrThrow({ where: { designation: "Vodka" } });
    await prisma.mouvementStock.createMany({ data: Array.from({ length: PLAFOND_MOUVEMENTS_EXPORT + 1 }, (_, i) => ({ articleId: a.id, type: "ENTREE" as const, quantite: 1, date: J(`2026-06-${String((i % 28) + 1).padStart(2, "0")}`) })) });
    const lireTitres = async (mois: string) => {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load((await (await appel(mois, "excel")).arrayBuffer()) as never);
      const titres: string[] = [];
      wb.eachSheet((ws) => ws.eachRow((r) => { const v = String(r.getCell(1).value ?? ""); if (v.startsWith("MOUVEMENTS DU MOIS")) titres.push(v); }));
      return titres;
    };
    const juin = await lireTitres("2026-6");
    expect(juin).toHaveLength(3);
    expect(juin.every((t) => /LISTE COUPÉE aux 8[  ]000 premiers/.test(t))).toBe(true);
    // Un mois qui tient sous le plafond n'a pas cette mention.
    expect((await lireTitres("2026-9")).some((t) => /COUPÉE/.test(t))).toBe(false);
  }, 180_000);

  it("refuse un mois illisible par un texte lisible (400)", async () => {
    const res = await appel("n'importe quoi", "excel");
    expect(res.status).toBe(400);
    expect(res.headers.get("Content-Type")).toMatch(/text\/plain/);
  });
});

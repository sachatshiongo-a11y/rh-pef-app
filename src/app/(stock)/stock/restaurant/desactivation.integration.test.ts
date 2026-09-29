import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import ExcelJS from "exceljs";
import type { PrismaClient, Role } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";
import { estStock } from "@/lib/espaces";
import { jourKinshasaISO } from "@/lib/date-paiement";

/**
 * « Désactiver » un article du Stock restaurant (2026-09-29), sur une VRAIE base : jamais une
 * disparition silencieuse du stock.
 *  a) un article qui a encore du stock compté ne se désactive qu'après une confirmation qui nomme
 *     ce stock et sa conséquence ;
 *  b) désactivé avec du stock : l'ingrédient rattaché passe « À vérifier » (jamais le dépôt seul) ;
 *  c) un article désactivé ne se compte plus ;
 *  d) les documents d'une période passée le listent encore, « (désactivé) ».
 */
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient, user: { id: "", role: "ADMIN" as Role, accesStock: false, nom: "Direction" } }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));
vi.mock("@/lib/auth", () => ({
  verifySession: async () => H.user,
  requireModule: (u: { role: Role; accesStock?: boolean }, espace: string) => {
    if (espace !== "stock" || !estStock(u)) throw new Error("Accès refusé : module non autorisé.");
  },
  requireRole: (u: { role: Role }, roles: Role[]) => { if (!roles.includes(u.role)) throw new Error("Accès refusé."); },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const { changerActivationArticlesResto, majComptage } = await import("./actions");
const { chargerEntreesStockResto } = await import("@/lib/stock-restaurant-charger");
const { chargerFichesVues, chargerArticlesDesFiches, chargerStocksDesFiches } = await import("../fiches/_data/charger-fiche");
const { disponibilitesDesFiches, resumerDispo } = await import("../fiches/_data/fiche-calc");
const { GET: exportExcel } = await import("./excel/route");
const { chargerConsommationsReelles } = await import("../journalier/fiches-data");
const { texteCase } = await import("@/lib/fiches-conso");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
const ids: Record<string, string> = {};
const le = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const AUJ = jourKinshasaISO();

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  ids.direction = (await prisma.user.create({ data: { email: "dir@pef.test", nom: "Direction", role: "ADMIN" } })).id;
  ids.stock = (await prisma.user.create({ data: { email: "stock@pef.test", nom: "Stock", role: "STOCK" } })).id;
  // Farine : catalogue (dépôt 10 kg, mouvementé aujourd'hui) + restaurant (20 kg comptés aujourd'hui).
  const farine = await prisma.articleStock.create({ data: { designation: "Farine T45", domaine: "NOURRITURE", unite: "kg", stock: { create: { quantite: 10 } } } });
  ids.farineCat = farine.id;
  await prisma.mouvementStock.create({ data: { articleId: farine.id, type: "ENTREE", quantite: 10, date: le(AUJ) } });
  ids.farine = (await prisma.articleResto.create({ data: { espace: "CUISINE", designation: "Farine", unite: "kg", ordre: 1, articleStockId: farine.id } })).id;
  await prisma.comptageResto.create({ data: { articleRestoId: ids.farine, date: le(AUJ), quantite: 20 } });
  // Glaçons : comptés 0 le 22/09, puis 5 livrés depuis ; Sucre : compté 0, rien depuis ; Sel : jamais compté.
  const glacesCat = await prisma.articleStock.create({ data: { designation: "Glaçons sac 5 kg", domaine: "BOISSON", unite: "sac" } });
  ids.glacons = (await prisma.articleResto.create({ data: { espace: "BAR", designation: "Glaçons", unite: "sac", ordre: 1, articleStockId: glacesCat.id } })).id;
  await prisma.comptageResto.create({ data: { articleRestoId: ids.glacons, date: le("2026-09-22"), quantite: 0 } });
  await prisma.mouvementStock.create({ data: { articleId: glacesCat.id, type: "SORTIE", categorieSortie: "LIVRAISON_RESTAURANT", quantite: 5, date: le("2026-09-24") } });
  ids.sucre = (await prisma.articleResto.create({ data: { espace: "BAR", designation: "Sucre", unite: "kg", ordre: 2 } })).id;
  await prisma.comptageResto.create({ data: { articleRestoId: ids.sucre, date: le("2026-09-22"), quantite: 0 } });
  ids.sel = (await prisma.articleResto.create({ data: { espace: "BAR", designation: "Sel", unite: "kg", ordre: 3 } })).id;
  // Plat : 100 g de farine par portion.
  ids.plat = (await prisma.ficheTechnique.create({ data: { nom: "Pâtes fraîches", ingredients: { create: [{ articleId: farine.id, unite: "g", quantite: 100, ordre: 1 }] } } })).id;
}, 120_000);
afterAll(async () => { await fermer?.(); });

async function dispoDuPlat() {
  const [vues, articles, stocks] = await Promise.all([chargerFichesVues(), chargerArticlesDesFiches(), chargerStocksDesFiches(AUJ)]);
  const vue = vues.find((v) => v.id === ids.plat)!;
  return resumerDispo(disponibilitesDesFiches(vues, articles, stocks, AUJ).get(ids.plat)!, vue);
}

describe("désactiver un article du restaurant", () => {
  it("droits de la Direction ; sans stock compté, la désactivation est directe", async () => {
    H.user = { id: ids.stock!, role: "STOCK", accesStock: false, nom: "Stock" };
    expect(await changerActivationArticlesResto([ids.sucre!], false)).toEqual({ erreur: "Accès refusé." });
    H.user = { id: ids.direction!, role: "ADMIN", accesStock: false, nom: "Direction" };
    expect(await changerActivationArticlesResto([ids.sucre!, ids.sel!], false)).toEqual({ ok: true, modifies: 2 });
  });

  it("a) du stock compté ou livré depuis : RIEN n'est écrit, la confirmation nomme le stock et la conséquence", async () => {
    const r = await changerActivationArticlesResto([ids.farine!, ids.glacons!], false);
    const jj = `${AUJ.slice(8, 10)}/${AUJ.slice(5, 7)}`;
    expect(r).toEqual({
      ok: false, aConfirmer: true,
      message: `« Farine » : 20 kg comptés au restaurant le ${jj}. « Glaçons » : 0 sac comptés au restaurant le 22/09, et 5 sac livrés depuis. Désactiver quand même ? Ce stock ne sera plus compté dans la disponibilité des plats : les plats qui l'utilisent passeront « À vérifier ».`,
    });
    expect(await prisma.articleResto.count({ where: { id: { in: [ids.farine!, ids.glacons!] }, actif: true } })).toBe(2);
  });

  it("b) confirmée : l'ingrédient rattaché passe « À vérifier » (plus jamais le dépôt seul) ; c) plus de comptage", async () => {
    expect((await dispoDuPlat()).etat).toBe("DISPONIBLE"); // 10 kg au dépôt + 20 kg au restaurant
    expect(await changerActivationArticlesResto([ids.farine!], false, true)).toEqual({ ok: true, modifies: 1 });
    const d = await dispoDuPlat();
    expect(d.etat).toBe("A_VERIFIER");
    expect(d.raisons).toEqual(["Farine T45 : article du restaurant désactivé avec du stock compté"]);
    expect(await majComptage(ids.farine!, AUJ, "3")).toEqual({ erreur: "« Farine » est désactivé : la Direction doit le réactiver avant tout comptage." });
    expect((await prisma.comptageResto.findFirstOrThrow({ where: { articleRestoId: ids.farine } })).quantite.toString()).toBe("20");
    // Réactivé : le stock compté revient, le plat aussi.
    expect(await changerActivationArticlesResto([ids.farine!], true)).toEqual({ ok: true, modifies: 1 });
    expect((await dispoDuPlat()).etat).toBe("DISPONIBLE");
    expect(await prisma.journalAudit.count({ where: { entite: "ArticleResto", champ: "actif" } })).toBe(4);
  });

  it("d) semaine passée : l'article désactivé qui y a un comptage ou une livraison reste listé « (désactivé) » ; sans activité, il n'y est pas", async () => {
    await changerActivationArticlesResto([ids.glacons!], false, true);
    // Hors de la saisie du jour (stock théorique courant, disponibilité) :
    expect(JSON.stringify(await chargerEntreesStockResto({ depuis: AUJ, jusquA: AUJ }))).not.toContain(ids.glacons);
    // Export Excel du Stock restaurant de la semaine du 22/09.
    const r = await exportExcel(new Request("http://pef.test/stock/restaurant/excel?espace=BAR&semaine=2026-09-22"));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await r.arrayBuffer()) as unknown as ArrayBuffer);
    const noms = Array.from(wb.worksheets[0]!.getSheetValues(), (x) => (Array.isArray(x) ? x[1] : null));
    expect(noms).toContain("Glaçons (désactivé)");
    expect(noms).toContain("Sucre (désactivé)"); // compté 0 le 22/09 : c'est une activité de la semaine
    expect(noms).not.toContain("Sel (désactivé)"); // jamais compté ni livré : rien à montrer
    // Consommation réelle de la semaine.
    const [bar] = await chargerConsommationsReelles(le("2026-09-21"), ["BAR"]);
    const ligne = bar!.sections.flatMap((s) => s.lignes).find((l) => l.designation.startsWith("Glaçons"))!;
    expect(ligne.designation).toBe("Glaçons (désactivé) (sac)");
    expect(ligne.cases.map(texteCase)).toHaveLength(6);
  }, 60_000);
});

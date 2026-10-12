import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// ONGLET MOUVEMENTS CLASSÉ PAR ANNÉE ET PAR MOIS (demande de la Direction, 2026-10-12 : « classer les entrées et les
// sorties en fonction des mois et des années, avec la consommation totale du mois »). Rendu de la VRAIE page sur une
// base éphémère, horloge figée au 12 octobre 2026. Ce qu'on tient ici :
//  - sans paramètre : l'année en cours, tous les mois ; la liste est groupée par mois, du plus récent au plus ancien ;
//  - année, mois et type se combinent, chaque lien garde les autres paramètres, les compteurs suivent ;
//  - les totaux d'un mois (entrées, sorties, consommation + valeur) sont ceux du mois ENTIER, même page partielle ;
//  - la consommation de l'en-tête du mois en cours = la carte « Consommation du mois » du haut ;
//  - une valeur inconnue (pas de prix) se dit « — », jamais 0 ;
//  - le mois est celui de Kinshasa (le 1er à 00 h 30 de Kinshasa est dans son mois).
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
const A = vi.hoisted(() => ({ user: { id: "seed", role: "ADMIN", nom: "Sacha Test", email: "mois@pef.cd", accesStock: false, employeeId: null } }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));
vi.mock("@/lib/auth", async () => {
  const vrai = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return { ...vrai, verifySession: async () => A.user, requireModule: () => {}, requireRole: () => {} };
});
vi.mock("../actions", () => ({
  supprimerArticle: async () => {}, modifierArticle: async () => ({}), definirFournisseurHabituel: async () => ({}),
  ajouterFournisseursArticle: async () => ({}), retirerFournisseursArticle: async () => ({}),
}));
vi.mock("next/navigation", async () => {
  const vrai = await vi.importActual<typeof import("next/navigation")>("next/navigation");
  return { ...vrai, useRouter: () => ({ push: () => {}, refresh: () => {} }) };
});

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let farine: string, sel: string, riz: string;
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const MIDI_12_OCTOBRE = new Date("2026-10-12T10:00:00Z");
const texte = (html: string) =>
  html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/[\s  ]+/g, " ");

async function rendre(sp: Record<string, string | string[]> = {}, id = farine): Promise<string> {
  const { default: Page } = await import("./page");
  const element = await Page({ params: Promise.resolve({ id }), searchParams: Promise.resolve(sp) });
  return renderToStaticMarkup(element);
}
/** Le bloc d'en-tête d'un mois (`data-totaux-mois="2026-10"`), en texte. */
const enTete = (html: string, mois: string) => texte(html.match(new RegExp(`<dl data-totaux-mois="${mois}".*?</dl>`, "s"))?.[0] ?? "");
const ordreDesMois = (html: string) => [...html.matchAll(/<section aria-label="([^"]+)" data-mois=/g)].map((m) => m[1]);

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  const u = await prisma.user.create({ data: { email: "mois@pef.cd", nom: "Sacha Test", role: "ADMIN" } });
  A.user.id = u.id;

  farine = (await prisma.articleStock.create({ data: { designation: "Farine", domaine: "NOURRITURE", unite: "kg", prixUnitaireUSD: 2.5, devisePrix: "USD" } })).id;
  sel = (await prisma.articleStock.create({ data: { designation: "Sel fin", domaine: "NOURRITURE", unite: "kg" } })).id; // SANS prix
  riz = (await prisma.articleStock.create({ data: { designation: "Riz", domaine: "NOURRITURE", unite: "kg", prixUnitaireUSD: 1, devisePrix: "USD" } })).id;
  for (const id of [farine, sel, riz]) await prisma.stock.create({ data: { articleId: id, quantite: 10, stockMinimum: 1, seuilUrgent: 0 } });

  const mv = (articleId: string, type: "ENTREE" | "SORTIE" | "AJUSTEMENT", quantite: number, date: string, categorieSortie: string | null = null) =>
    prisma.mouvementStock.create({ data: { articleId, type, quantite, date: d(date), ...(categorieSortie ? { categorieSortie } : {}) } });
  await mv(farine, "ENTREE", 10, "2026-10-01");
  await mv(farine, "SORTIE", 3, "2026-10-05", "LIVRAISON_RESTAURANT");
  await mv(farine, "SORTIE", 1, "2026-10-06", "PERTE");
  await mv(farine, "SORTIE", 2, "2026-10-07");
  await mv(farine, "AJUSTEMENT", 4, "2026-10-08");
  await mv(farine, "SORTIE", 5, "2026-09-30", "LIVRAISON_RESTAURANT");
  await mv(farine, "ENTREE", 20, "2026-09-02");
  await mv(farine, "ENTREE", 7, "2025-12-31");
  await mv(farine, "SORTIE", 6, "2025-12-15", "PERTE");
  await mv(sel, "SORTIE", 2, "2026-10-03", "LIVRAISON_RESTAURANT");
  // Riz : 60 sorties d'un kilo en octobre (plus que les 50 d'une page) et 3 en septembre.
  await prisma.mouvementStock.createMany({
    data: Array.from({ length: 60 }, (_, i) => ({ articleId: riz, type: "SORTIE" as const, quantite: 1, date: d(`2026-10-${String((i % 11) + 1).padStart(2, "0")}`), categorieSortie: "LIVRAISON_RESTAURANT" })),
  });
  await prisma.mouvementStock.createMany({ data: [1, 2, 3].map((j) => ({ articleId: riz, type: "SORTIE" as const, quantite: 1, date: d(`2026-09-0${j}`), categorieSortie: "LIVRAISON_RESTAURANT" })) });
});
afterAll(async () => { await fermer(); });
// Seule la date est figée : les temporisateurs de la base continuent de tourner.
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"], now: MIDI_12_OCTOBRE }); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("sans paramètre : l'année en cours, tous les mois", () => {
  it("2026 est la pastille active, « Tous les mois » aussi ; les compteurs suivent l'année ; l'onglet garde le total de l'article", async () => {
    const html = await rendre();
    expect(html).toMatch(/aria-current="page"[^>]*>2026 \(7\)</);
    expect(html).toMatch(/>Toutes \(9\)</);
    expect(html).toMatch(/aria-current="page"[^>]*>Tous les mois \(7\)</);
    expect(html).toMatch(/>Octobre \(5\)</);
    expect(html).toMatch(/>Septembre \(2\)</);
    expect(html).not.toMatch(/>Décembre \(/); // 2025 : pas dans cette année
    // Pastilles de type de l'année : 2 entrées, 4 sorties, 1 ajustement.
    for (const lib of ["Entrées (2)", "Sorties (4)", "Ajustements (1)", "Tous (7)"]) expect(html).toContain(`${lib}</a>`);
    expect(html).toMatch(/>Mouvements \(9\)</); // le total de l'article, pas celui de l'année
  });
  it("la liste est groupée par mois, du plus récent au plus ancien, un en-tête par mois", async () => {
    const html = await rendre();
    expect(ordreDesMois(html)).toEqual(["Octobre 2026", "Septembre 2026"]);
    expect(html).toMatch(/<h3[^>]*>Octobre 2026<\/h3>/);
  });
  it("?annee=toutes : toutes les années, mois inclus, sans pastilles de mois", async () => {
    const html = await rendre({ annee: "toutes" });
    expect(ordreDesMois(html)).toEqual(["Octobre 2026", "Septembre 2026", "Décembre 2025"]);
    expect(html).not.toContain('aria-label="Mois de');
    expect(html).toMatch(/aria-current="page"[^>]*>Toutes \(9\)</);
  });
  it("une année ou un mois inconnus retombent sur l'année en cours / tous les mois", async () => {
    const html = await rendre({ annee: "1999", mois: "2" });
    expect(html).toMatch(/aria-current="page"[^>]*>2026 \(7\)</);
    expect(ordreDesMois(html)).toEqual(["Octobre 2026", "Septembre 2026"]);
    const sansMouvements = await rendre({ annee: "2026", mois: "2" }); // février n'a aucun mouvement
    expect(ordreDesMois(sansMouvements)).toEqual(["Octobre 2026", "Septembre 2026"]);
  });
});

describe("année, mois et type se combinent", () => {
  it("?annee=2026&mois=9&filtre=sorties : la seule sortie de septembre ; compteurs du mois ; les liens gardent les autres paramètres", async () => {
    const html = await rendre({ annee: "2026", mois: "9", filtre: "sorties" });
    expect(ordreDesMois(html)).toEqual(["Septembre 2026"]);
    expect(html).toContain('data-pastille-type="SORTIE"');
    expect(html).not.toContain('data-pastille-type="ENTREE"');
    for (const lib of ["Entrées (1)", "Sorties (1)", "Ajustements (0)", "Tous (2)"]) expect(html).toContain(`${lib}</a>`);
    expect(html).toMatch(/aria-current="page"[^>]*>Septembre \(2\)</);
    // Le type garde l'année et le mois ; le mois garde l'année et le type ; l'année garde le type (et repart sur tous les mois).
    expect(html).toContain(`href="/stock/catalogue/${farine}?onglet=mouvements&amp;annee=2026&amp;mois=9"`); // Tous (type)
    expect(html).toContain(`href="/stock/catalogue/${farine}?onglet=mouvements&amp;annee=2026&amp;mois=9&amp;filtre=entrees"`);
    expect(html).toContain(`href="/stock/catalogue/${farine}?onglet=mouvements&amp;annee=2026&amp;mois=10&amp;filtre=sorties"`);
    expect(html).toContain(`href="/stock/catalogue/${farine}?onglet=mouvements&amp;annee=2025&amp;filtre=sorties"`);
  });
  it("décembre 2025 : un mois d'une autre année", async () => {
    const html = await rendre({ annee: "2025", mois: "12" });
    expect(ordreDesMois(html)).toEqual(["Décembre 2025"]);
    expect(enTete(html, "2025-12")).toContain("+7");
    expect(enTete(html, "2025-12")).toContain("−6");
    expect(html).toMatch(/aria-current="page"[^>]*>2025 \(2\)</);
  });
  it("le type « Entrées » d'un mois sans entrée dit « Aucun mouvement de ce type en … » et propose de tout voir", async () => {
    const html = await rendre({ annee: "2025", mois: "12", filtre: "ajustements" });
    expect(texte(html)).toContain("Aucun mouvement de ce type en décembre 2025 (9 au total pour cet article).");
    expect(html).toContain(`href="/stock/catalogue/${farine}?onglet=mouvements&amp;annee=toutes"`);
  });
  it("l'export PDF suit l'année, le mois et le type choisis", async () => {
    const html = await rendre({ annee: "2026", mois: "9", filtre: "sorties" });
    expect(html).toContain(`href="/stock/catalogue/${farine}/pdf?annee=2026&amp;mois=9&amp;filtre=sorties"`);
    expect(await rendre()).toContain(`href="/stock/catalogue/${farine}/pdf?annee=2026"`);
  });
});

describe("totaux d'un mois", () => {
  it("octobre : entrées, sorties et consommation (quantité + valeur) ; l'ajustement n'y compte pas ; les pertes sont dites", async () => {
    const t = enTete(await rendre(), "2026-10");
    expect(t).toContain("Entrées du mois +10 kg");
    expect(t).toContain("Sorties du mois −6 kg");
    expect(t).toContain("Consommation totale du mois 6 kg · 15,00 $ · dont 1 kg de pertes"); // 6 kg × 2,50 $
  });
  it("septembre : −5 kg livrés, 12,50 $, +20 kg d'entrée", async () => {
    const t = enTete(await rendre(), "2026-9");
    expect(t).toContain("+20 kg");
    expect(t).toContain("−5 kg");
    expect(t).toContain("Consommation totale du mois 5 kg · 12,50 $");
  });
  it("les totaux ne dépendent pas du filtre de type : ils restent ceux du mois entier", async () => {
    const t = enTete(await rendre({ filtre: "entrees" }), "2026-10");
    expect(t).toContain("Entrées du mois +10 kg");
    expect(t).toContain("Sorties du mois −6 kg");
  });
  it("valeur inconnue : un article sans prix dit « valeur — », jamais 0", async () => {
    const html = await rendre({}, sel);
    const t = enTete(html, "2026-10");
    expect(t).toContain("Consommation totale du mois 2 kg · valeur —");
    expect(t).not.toMatch(/0,00 \$|\b0 \$/);
  });
  it("page partielle : 60 sorties en octobre, 50 affichées, les totaux restent ceux du mois entier et l'écran le dit", async () => {
    const html = await rendre({}, riz);
    const t = enTete(html, "2026-10");
    expect(t).toContain("Sorties du mois −60 kg");
    expect(t).toContain("Consommation totale du mois 60 kg · 60,00 $");
    expect(texte(html)).toContain("50 mouvements affichés sur 60 ce mois-ci — les totaux ci-dessus sont ceux du mois entier.");
    expect(ordreDesMois(html)).toEqual(["Octobre 2026"]); // la page s'arrête à 50 : septembre vient avec « Voir les … plus anciens »
  });
  it("« tout voir » affiche les 63 et plus aucun mois n'est partiel", async () => {
    const html = await rendre({ mouvements: "tous" }, riz);
    expect(html).not.toContain("data-mois-partiel");
    expect(ordreDesMois(html)).toEqual(["Octobre 2026", "Septembre 2026"]);
    expect(enTete(html, "2026-9")).toContain("−3 kg");
  });
});

describe("la consommation de l'en-tête = la carte « Consommation du mois »", () => {
  const nombre = (s: string) => Number(s.replace(",", "."));
  const carte = (html: string) => nombre(texte(html).match(/Consommation du mois ([\d,]+) kg/)?.[1] ?? "NaN");
  const entete = (html: string, mois: string) => nombre(enTete(html, mois).match(/Consommation totale du mois ([\d,]+) kg/)?.[1] ?? "NaN");

  it("pour le mois en cours, les deux valent la même chose (octobre 2026)", async () => {
    const html = await rendre();
    expect(carte(html)).toBe(6);
    expect(entete(html, "2026-10")).toBe(carte(html));
  });
  it("même égalité pour les deux autres articles (avec et sans pertes)", async () => {
    for (const id of [riz, sel]) {
      const html = await rendre({}, id);
      expect(entete(html, "2026-10")).toBe(carte(html));
    }
  });
});

describe("bornes de mois à l'heure de Kinshasa", () => {
  it("le 30/09 à 23 h 30 UTC, il est déjà le 1er octobre 00 h 30 à Kinshasa : la carte et l'en-tête sont ceux d'OCTOBRE", async () => {
    vi.setSystemTime(new Date("2026-09-30T23:30:00Z"));
    const html = await rendre();
    expect(texte(html)).toContain("Consommation du mois 6 kg");
    expect(enTete(html, "2026-10")).toContain("Consommation totale du mois 6 kg");
  });
  it("à 22 h 59 UTC il est encore septembre à Kinshasa : la carte vaut la consommation de septembre (5 kg)", async () => {
    vi.setSystemTime(new Date("2026-09-30T22:59:00Z"));
    const html = await rendre();
    expect(texte(html)).toContain("Consommation du mois 5 kg");
    expect(enTete(html, "2026-9")).toContain("Consommation totale du mois 5 kg");
  });
  it("le 31/12 à 23 h 30 UTC, c'est déjà 2027 à Kinshasa : l'année en cours est 2027 (aucun mouvement, mais la pastille existe)", async () => {
    vi.setSystemTime(new Date("2026-12-31T23:30:00Z"));
    const html = await rendre();
    expect(html).toMatch(/aria-current="page"[^>]*>2027 \(0\)</);
    expect(texte(html)).toContain("Aucun mouvement en 2027 (9 au total pour cet article).");
  });
});

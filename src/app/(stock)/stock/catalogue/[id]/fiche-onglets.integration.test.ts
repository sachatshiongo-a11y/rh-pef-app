import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";
import { jourCourantKinshasaISO } from "@/lib/heure-kinshasa";

// FICHE ARTICLE EN ONGLETS (demande de la Direction, 2026-10-12 : « agencée comme la fiche fournisseur ») :
// rendu de la VRAIE page sur une base éphémère. Ce qu'on tient ici :
//  - le gabarit : fil d'Ariane, titre, boutons, quatre cartes de chiffres, onglets avec compteurs ;
//  - l'onglet et le filtre viennent de l'URL (?onglet=, ?filtre=), valeur inconnue → Mouvements / Tous ;
//  - pastilles de filtre Entrées / Sorties / Ajustements / Tous avec leurs effectifs exacts ;
//  - pastille de type EN COULEUR SELON LE SENS (Entrée vert, Sortie rouge, Ajustement neutre) + motif ;
//  - « Fiches techniques » n'existe que si l'article y est utilisé ;
//  - seules les données de l'onglet affiché sont lues ;
//  - Informations garde tous les champs ; hors Direction = proposition, pas de Supprimer.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
const A = vi.hoisted(() => ({ user: { id: "seed", role: "ADMIN", nom: "Sacha Test", email: "article@pef.cd", accesStock: false, employeeId: null } }));
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
// Les composants clients n'appellent leurs actions qu'au clic : ici, rendu seul.
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
let idA: string, idSansFiche: string;
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const texte = (html: string) =>
  html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/[\s  ]+/g, " ");

async function rendre(sp: Record<string, string | string[]> = {}, id = idA): Promise<string> {
  const { default: Page } = await import("./page");
  const element = await Page({ params: Promise.resolve({ id }), searchParams: Promise.resolve(sp) });
  return renderToStaticMarkup(element);
}

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  const u = await prisma.user.create({ data: { email: "article@pef.cd", nom: "Sacha Test", role: "ADMIN" } });
  A.user.id = u.id;

  const f1 = await prisma.fournisseur.create({ data: { nom: "SENEVE" } });
  const f2 = await prisma.fournisseur.create({ data: { nom: "AUTRE SARL" } });
  const cat = await prisma.categorieStock.create({ data: { nom: "Spiritueux", domaine: "BOISSON" } });
  const a = await prisma.articleStock.create({
    data: {
      designation: "Cointreau", marque: "Rémy", domaine: "BOISSON", unite: "bouteille", contenance: 70, contenanceUnite: "cl", code: "137",
      categorieId: cat.id, fournisseurId: f1.id,
      fournisseurs: { create: [{ fournisseurId: f1.id, habituel: true }, { fournisseurId: f2.id, habituel: false }] },
    },
  });
  idA = a.id;
  await prisma.stock.create({ data: { articleId: a.id, quantite: 10, stockMinimum: 12, seuilUrgent: 3 } });
  idSansFiche = (await prisma.articleStock.create({ data: { designation: "Sel fin", domaine: "NOURRITURE", unite: "kg" } })).id;

  const aujourdhui = d(jourCourantKinshasaISO());
  const mv = (type: "ENTREE" | "SORTIE" | "AJUSTEMENT", quantite: number, date: Date, extra: Record<string, unknown> = {}) =>
    prisma.mouvementStock.create({ data: { articleId: a.id, type, quantite, date, ...extra } });
  await mv("ENTREE", 6, d("2026-01-05"), { origine: "Liste d'achat", fournisseurId: f1.id, montantUSD: 60 });
  await mv("ENTREE", 4, d("2026-01-20"), { origine: "Liste d'achat", fournisseurId: f1.id, montantUSD: 60 });
  await mv("SORTIE", 3, aujourdhui, { categorieSortie: "LIVRAISON_RESTAURANT" });
  await mv("SORTIE", 1, aujourdhui, { categorieSortie: "PERTE" });
  await mv("SORTIE", 2, d("2026-01-25"));
  await mv("AJUSTEMENT", 1, d("2026-01-30"));

  // Fiche technique qui utilise Cointreau (et pas « Sel fin »).
  const fiche = await prisma.ficheTechnique.create({ data: { nom: "Margarita", type: "BAR" } });
  await prisma.ingredientFiche.create({ data: { ficheId: fiche.id, articleId: a.id, unite: "cl", quantite: 2 } });
});
afterAll(async () => { await fermer(); });
afterEach(() => { vi.restoreAllMocks(); A.user.role = "ADMIN"; });

describe("gabarit de la fiche article (le même que la fiche fournisseur)", () => {
  it("fil d'Ariane, titre, résumé, boutons Direction, quatre cartes, onglets avec compteurs", async () => {
    const html = await rendre();
    const t = texte(html);
    expect(t).toContain("Inventaire"); // fil d'Ariane
    expect(html).toMatch(/<h1[^>]*>Cointreau Rémy 70 cl<\/h1>/); // marque et contenance dans le nom affiché
    expect(t).toContain("Boissons · Spiritueux · Code 137");
    expect(html).toMatch(/>SENEVE<\/a>/); // fournisseur habituel cliquable
    expect(t).toContain("Modifier");
    expect(t).toContain("Supprimer");
    for (const lib of ["Stock actuel", "Valeur du stock", "Dernier prix d'achat", "Consommation du mois"]) expect(t).toContain(lib);
    for (const lib of ["Mouvements (6)", "Fournisseurs (2)", "Fiches techniques (1)", "Prix (2)", "Informations"]) expect(html).toContain(`>${lib}</a>`);
    expect(html).toContain(`href="/stock/catalogue/${idA}?onglet=fournisseurs"`);
  });

  it("les cartes : stock + alerte + seuils, dernier prix d'achat, consommation du mois (pertes dites à part)", async () => {
    const t = texte(await rendre());
    expect(t).toContain("Stock actuel 10 bouteille À réapprovisionner · minimum 12 · urgent 3");
    expect(t).toContain("Dernier prix d'achat 15,00 $"); // 60 $ / 4 bouteilles (dernière entrée)
    expect(t).toContain("Consommation du mois 4 bouteille dont 1 bouteille de pertes"); // 3 + 1 ce mois-ci ; la sortie de janvier n'y est pas
  });

  it("les cartes restent au-dessus des onglets, quel que soit l'onglet", async () => {
    for (const onglet of ["mouvements", "fournisseurs", "fiches", "prix", "informations"]) {
      const t = texte(await rendre({ onglet }));
      expect(t, onglet).toContain("Consommation du mois 4 bouteille");
      expect(t, onglet).toContain("Stock actuel 10 bouteille");
    }
  });

  it("non-Direction : proposition de modification, pas de Supprimer", async () => {
    A.user.role = "STOCK";
    const t = texte(await rendre());
    expect(t).toContain("Proposer une modification");
    expect(t).not.toContain("Supprimer");
  });
});

describe("onglet et filtre dans l'URL", () => {
  it("sans ?onglet : Mouvements est actif, filtre Tous ; une valeur inconnue retombe dessus", async () => {
    for (const sp of [{}, { onglet: "nimporte-quoi", filtre: "xx" }] as Record<string, string>[]) {
      const html = await rendre(sp);
      expect(html).toMatch(/aria-current="page"[^>]*>Mouvements \(6\)</);
      expect(html).toMatch(/aria-current="page"[^>]*>Tous \(6\)</);
    }
  });
  it("?onglet=prix ou informations ouvre cet onglet", async () => {
    expect(await rendre({ onglet: "prix" })).toMatch(/aria-current="page"[^>]*>Prix \(2\)</);
    expect(await rendre({ onglet: "informations" })).toMatch(/aria-current="page"[^>]*>Informations</);
  });
  it("Fiches techniques : absent si l'article n'y est pas utilisé, et le lien direct retombe sur Mouvements", async () => {
    const html = await rendre({ onglet: "fiches" }, idSansFiche);
    expect(html).not.toContain("Fiches techniques (");
    expect(html).toMatch(/aria-current="page"[^>]*>Mouvements \(0\)</);
    expect(texte(html)).toContain("Aucun mouvement de stock pour cet article.");
  });
  it("Fiches techniques : la fiche est un lien vers sa page", async () => {
    const html = await rendre({ onglet: "fiches" });
    expect(html).toMatch(/aria-current="page"[^>]*>Fiches techniques \(1\)</);
    expect(html).toMatch(/href="\/stock\/fiches\/[^"]+"[^>]*>Margarita</);
    expect(texte(html)).toContain("2 cl");
  });
});

describe("onglet Mouvements : pastilles de filtre et pastilles de type en couleur", () => {
  it("les effectifs sont exacts et chaque pastille mène à son filtre (?filtre=)", async () => {
    const html = await rendre();
    for (const lib of ["Entrées (2)", "Sorties (3)", "Ajustements (1)", "Tous (6)"]) expect(html).toContain(`${lib}</a>`);
    expect(html).toContain(`href="/stock/catalogue/${idA}?onglet=mouvements&amp;filtre=sorties"`);
    expect(html).toContain(`href="/stock/catalogue/${idA}?onglet=mouvements"`); // Tous = le défaut, adresse courte
  });
  it("?filtre=sorties : seules les sorties, avec leur motif ; le filtre actif est marqué", async () => {
    const html = await rendre({ onglet: "mouvements", filtre: "sorties" });
    expect(html).toMatch(/aria-current="page"[^>]*>Sorties \(3\)</);
    expect(html).not.toContain('data-pastille-type="ENTREE"');
    expect(html).not.toContain('data-pastille-type="AJUSTEMENT"');
    expect(html.match(/data-pastille-type="SORTIE"/g)).toHaveLength(3);
    expect(html).toContain('data-pastille-motif="PERTE"');
    expect(html).toContain('data-pastille-motif="LIVRAISON_RESTAURANT"');
    expect(html).toContain("sans motif"); // la sortie de janvier n'a pas de motif : dit tel quel
  });
  it("Entrée en VERT, Sortie en ROUGE, Ajustement neutre (jamais l'un des deux sens)", async () => {
    const html = await rendre({ onglet: "mouvements" });
    const classe = (type: string) => html.match(new RegExp(`data-pastille-type="${type}" class="([^"]*)"`))?.[1] ?? "";
    expect(classe("ENTREE")).toMatch(/bg-emerald-50 text-emerald-800/);
    expect(classe("SORTIE")).toMatch(/bg-red-50 text-red-800/);
    expect(classe("AJUSTEMENT")).toMatch(/bg-slate-100/);
    expect(classe("AJUSTEMENT")).not.toMatch(/emerald|red-/);
  });
  it("un filtre sans résultat dit pourquoi et propose de tout voir", async () => {
    await prisma.mouvementStock.deleteMany({ where: { articleId: idSansFiche } });
    const html = await rendre({ onglet: "mouvements", filtre: "ajustements" }, idSansFiche);
    expect(texte(html)).toContain("Aucun mouvement de stock pour cet article.");
  });
});

describe("seules les données de l'onglet affiché sont lues", () => {
  const attendu: Record<string, { mouvements: number; fournisseurs: boolean }> = {
    mouvements: { mouvements: 1, fournisseurs: false },
    fournisseurs: { mouvements: 0, fournisseurs: true },
    prix: { mouvements: 0, fournisseurs: false },
    informations: { mouvements: 0, fournisseurs: false },
  };
  for (const [onglet, lu] of Object.entries(attendu)) {
    it(`?onglet=${onglet}`, async () => {
      const liste = vi.spyOn(prisma.mouvementStock, "findMany");
      await rendre({ onglet });
      // Toujours : les entrées sans facture pour le prix (1 requête). L'onglet Mouvements ajoute le contenu de la liste et les DLC.
      const sortiesDeLaListe = liste.mock.calls.filter(([arg]) => (arg as { take?: number } | undefined)?.take === 200).length;
      expect(sortiesDeLaListe, "liste des mouvements").toBe(lu.mouvements);
      const t = texte(await rendre({ onglet }));
      expect(t.includes("Ajouter un fournisseur"), "comparaison des prix").toBe(lu.fournisseurs);
    });
  }
});

describe("onglet Informations : rien ne disparaît", () => {
  it("tous les champs du formulaire de modification sont lisibles", async () => {
    const t = texte(await rendre({ onglet: "informations" }));
    for (const v of ["Cointreau", "Rémy", "137", "Boissons", "Spiritueux", "bouteille", "70 cl", "SENEVE", "12", "3"]) expect(t, v).toContain(v);
    for (const k of ["Désignation enregistrée", "Marque", "Code article", "Domaine", "Catégorie", "Unité", "Contenance d'une unité", "Fournisseur habituel", "Stock minimum", "Seuil urgent"]) expect(t, k).toContain(k);
  });
});

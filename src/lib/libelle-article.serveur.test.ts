// Le libellé d'article (désignation + contenance) côté SERVEUR : PDF du bon de commande (texte extrait),
// export Excel de l'inventaire, fiche de comptage vierge, Conso. journalière, notification « stock
// bas », refus « stock insuffisant » — et la preuve que les CLÉS restent sur la désignation brute
// (anti-doublon, fiche « Commande journalière » du classeur de la Direction, choix par id).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

const P = vi.hoisted(() => ({
  articles: [] as unknown[],
  stocks: [] as unknown[],
  sorties: [] as unknown[],
  notifications: [] as { message: string }[],
  emails: [] as string[],
  classeur: null as null | { feuilles: { entete: string[]; lignes: unknown[][] }[] },
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    articleStock: { findMany: async () => P.articles },
    stock: { findMany: async () => P.stocks },
    mouvementStock: { findMany: async () => P.sorties },
    user: { findMany: async () => [{ id: "u1", email: "direction@exemple.cd" }] },
    notification: { create: async ({ data }: { data: { message: string } }) => { P.notifications.push(data); return data; } },
  },
}));
vi.mock("@/lib/push", () => ({ envoyerPush: async () => {} }));
vi.mock("@/lib/email", () => ({ envoyerEmail: async (_a: string[], _s: string, corps: string) => { P.emails.push(corps); } }));
vi.mock("@/lib/garde-route", () => ({ exigerEspaceStock: async () => ({ ok: true }) }));
vi.mock("@/lib/taux-du-jour", () => ({ tauxDuJour: async () => 2800 }));
vi.mock("@/lib/inventaire-export", async (orig) => ({ ...(await orig<typeof import("@/lib/inventaire-export")>()), chargerHausses: async () => new Map() }));
vi.mock("@/lib/export-excel", () => ({ classeurExcel: async (c: NonNullable<typeof P.classeur>) => { P.classeur = c; return Buffer.from(""); } }));
vi.mock("@/lib/stock-restaurant-charger", () => ({
  chargerEntreesStockResto: async () => ({ debutLivraisons: "2026-10-05", articles: [], comptages: [], livraisons: [] }),
}));

import { renderPdfBuffer } from "@/lib/pdf/fonts";
import { pagesDuPdf } from "@/lib/test/pdf-lecture";
import { BonCommandeDocument } from "@/lib/pdf/bon-commande";
import { lignesFicheComptage } from "@/app/(stock)/stock/reconciliation/fiche/comptage-data";
import { chargerDonneesRestaurant } from "@/app/(stock)/stock/journalier/donnees-restaurant";
import { notifierNouvellesAlertes } from "@/lib/alerte-stock";
import { ligneManque } from "@/lib/validations-stock/stock-positif";
import { decisionArticle } from "@/lib/article-proche";
import { cleArticleExacte, memeDesignation } from "@/lib/achats-doublons";
import { nomImprime } from "@/lib/fiches-conso";
import { filtrerOptions, optionsArticles } from "@/lib/recherche-options";
import { libelleArticle } from "@/lib/libelle-article";

const D = (v: string) => new Prisma.Decimal(v);
beforeEach(() => { P.articles = []; P.stocks = []; P.sorties = []; P.notifications = []; P.emails = []; P.classeur = null; });

describe("bon de commande PDF (texte extrait)", () => {
  it("une ligne liée à un article porte sa contenance ; déjà dans le nom ou ligne libre : inchangée", async () => {
    const ligne = (id: string, designation: string, article: { contenance: Prisma.Decimal | null; contenanceUnite: string | null } | null) => ({
      id, bonDeCommandeId: "bc", articleId: article ? id : null, designation, unite: null, quantite: D("2"), uniteParCarton: null, nbCartons: null,
      prixUnitaireUSD: D("10"), totalLigneUSD: D("20"), article,
    });
    const bc = {
      id: "bc", numero: "042/PEF/SO/OCT/26", date: new Date("2026-10-09"), statut: "VALIDE", totalUSD: D("60"), delaiPaiement: null, modePaiement: null, commentaire: null,
      lignes: [
        ligne("l1", "Absolut Vodka", { contenance: D("75"), contenanceUnite: "cl" }),
        ligne("l2", "Campari-1L", { contenance: D("100"), contenanceUnite: "cl" }),
        ligne("l3", "Glaçons (sac)", null),
      ],
    };
    const pdf = await renderPdfBuffer(BonCommandeDocument({ bc: bc as never, fournisseur: null, acheteur: null }));
    const tout = (await pagesDuPdf(pdf)).map((p) => p.plat).join(" ");
    expect(tout).toContain("Absolut Vodka 75 cl");
    expect(tout).toContain("Campari-1L");
    expect(tout).not.toContain("Campari-1L 1 l");
    expect(tout).toContain("Glaçons (sac)");
  }, 120_000);
});

describe("export Excel de l'inventaire", () => {
  it("la colonne « Désignation » porte le libellé ; la recherche « vodka 75cl » le retrouve", async () => {
    const art = (id: string, designation: string, contenance: string | null, contenanceUnite: string | null) => ({
      id, code: null, designation, contenance: contenance === null ? null : D(contenance), contenanceUnite, domaine: "BOISSON", unite: "Bouteille",
      devisePrix: "USD", prixUnitaireUSD: D("20"), prixUnitaireCDF: null, uniteParCarton: null, fournisseurId: null,
      categorie: { nom: "Spiritueux" }, fournisseur: null, stock: { quantite: D("3"), stockMinimum: D("1"), seuilUrgent: D("0") },
    });
    P.articles = [art("v", "Absolut Vodka", "75", "cl"), art("g", "Gin", null, null), art("c", "Cointreau-70cl", "1", "l")];
    const { GET } = await import("@/app/(stock)/stock/catalogue/export/route");
    await GET(new Request("http://x/stock/catalogue/export"));
    const f = P.classeur!.feuilles[0]!;
    const col = f.entete.indexOf("Désignation");
    expect(col).toBe(1);
    expect(f.lignes.map((l) => l[col])).toEqual(["Absolut Vodka 75 cl", "Gin", "Cointreau-70cl"]);
    await GET(new Request("http://x/stock/catalogue/export?q=vodka%2075cl"));
    expect(P.classeur!.feuilles[0]!.lignes.map((l) => l[col])).toEqual(["Absolut Vodka 75 cl"]);
  });
});

describe("fiche de comptage vierge (PDF / Excel)", () => {
  it("imprime le libellé", () => {
    const { lignes } = lignesFicheComptage([
      { domaine: "BOISSON", designation: "Absolut Vodka", contenance: D("75"), contenanceUnite: "cl", unite: "Bouteille", categorie: { nom: "Spiritueux" }, fournisseur: null, stock: { quantite: 2 } },
    ], true);
    expect(lignes[1]![0]).toBe("Absolut Vodka 75 cl");
  });
});

describe("Conso. journalière", () => {
  it("les sorties du dépôt nomment l'article par son libellé", async () => {
    P.sorties = [{ articleId: "v", date: new Date("2026-10-06"), quantite: D("1"), categorieSortie: "LIVRAISON_RESTAURANT", article: { designation: "Absolut Vodka", contenance: D("75"), contenanceUnite: "cl" } }];
    const d = await chargerDonneesRestaurant(new Date("2026-10-05"), "BOISSON");
    expect(JSON.stringify(d.sorties)).toContain("Absolut Vodka 75 cl");
  });
});

describe("notifications et refus", () => {
  it("« Stock bas » nomme l'article par son libellé (cloche et e-mail)", async () => {
    P.stocks = [{ articleId: "v", quantite: D("0"), stockMinimum: D("2"), article: { designation: "Absolut Vodka", contenance: D("75"), contenanceUnite: "cl" } }];
    await notifierNouvellesAlertes(["v"], new Map());
    expect(P.notifications[0]!.message).toContain("Absolut Vodka 75 cl");
    expect(P.emails[0]).toContain("Absolut Vodka 75 cl");
  });

  it("le refus « stock insuffisant » nomme le libellé ; sans libellé, la désignation", () => {
    const m = { articleId: "v", designation: "Absolut Vodka", unite: "Bouteille", disponible: "1", demande: "3" };
    expect(ligneManque({ ...m, libelle: "Absolut Vodka 75 cl" })).toMatch(/^Absolut Vodka 75 cl : 1 Bouteille disponible, 3 Bouteille demandé/);
    expect(ligneManque(m)).toMatch(/^Absolut Vodka : /);
  });
});

describe("les clés restent sur la désignation BRUTE", () => {
  const vodka = { id: "v", designation: "Absolut Vodka", unite: "Bouteille", domaine: "BOISSON", prix: null, actif: true, contenance: "75", contenanceUnite: "cl" };

  it("anti-doublon : « Absolut Vodka » tapé = l'article existant (même désignation brute), malgré son libellé « … 75 cl »", () => {
    expect(libelleArticle(vodka)).toBe("Absolut Vodka 75 cl");
    const d = decisionArticle("Absolut Vodka", [vodka]);
    expect(d.type).toBe("auto");
    expect(cleArticleExacte("Absolut Vodka")).toBe(cleArticleExacte(vodka.designation));
    // Le libellé n'est pas la désignation : comparé tel quel, il ne serait pas « le même nom ».
    expect(memeDesignation("Absolut Vodka", libelleArticle(vodka))).toBe(false);
  });

  it("fiche « Commande journalière » (classeur de la Direction) : le nom imprimé ne prend pas la contenance", () => {
    expect(nomImprime({ designation: "Absolut Vodka", nomCourt: null, nomsRestaurant: [] })).toBe("Absolut Vodka");
    expect(nomImprime({ designation: "Absolut Vodka", nomCourt: "Vodka", nomsRestaurant: [] })).toBe("Vodka");
  });

  it("un choix d'article envoie l'id, jamais le libellé", () => {
    const [o] = filtrerOptions(optionsArticles([vodka]), "vodka 75cl");
    expect(o).toMatchObject({ id: "v", libelle: "Absolut Vodka 75 cl" });
  });
});

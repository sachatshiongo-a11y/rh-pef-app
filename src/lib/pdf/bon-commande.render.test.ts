import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { BonDeCommande, LigneBonDeCommande, Fournisseur, ParametresAchat } from "@prisma/client";
import { renderPdfBuffer } from "./fonts";
import { BonCommandeDocument } from "./bon-commande";
import { pagesDuPdf, policesDeRepli } from "@/lib/test/pdf-lecture";
import { acheteurDuBon } from "@/lib/bon-commande-acheteur";

/**
 * Bon de commande (PDF) — modèle de la Direction « BON DE COMMANDE N° 001/PEF/JANV/26 » :
 *  - colonnes « Nbre d'unités par paquet/carton » et « Unité » (sans colonne « Référence », voulu par la Direction) ;
 *  - blocs fournisseur (Adresse, ID National) et acheteur (Pays, Contact, Adresse de livraison) ;
 *  - au-delà de ~40 lignes, la page 2 n'avait PAS d'en-tête de colonnes : la ligne d'en-tête est `fixed`.
 * `PDF_ECHANTILLONS=<dossier>` dépose les PDF pour les regarder à l'œil.
 */

type Ligne = Partial<LigneBonDeCommande> & { article?: { contenance: null; contenanceUnite: null; unite?: string | null; uniteParCarton?: string | null } | null };

function ligne(i: number, extra: Ligne = {}): Ligne {
  return {
    id: `l${i}`, bonDeCommandeId: "bc1", designation: `Article ${i + 1}`, quantite: 10 as never, nbCartons: 2 as never,
    prixUnitaireUSD: 1.75 as never, totalLigneUSD: 17.5 as never, unite: "Kg", uniteParCarton: 5 as never, ...extra,
  };
}

function rendre(lignes: Ligne[], opts: { devise?: "USD" | "CDF"; fournisseur?: Partial<Fournisseur> | null; acheteur?: Partial<ParametresAchat> | null; societe?: Parameters<typeof BonCommandeDocument>[0]["societe"]; achats?: Parameters<typeof BonCommandeDocument>[0]["achats"] } = {}) {
  const devise = opts.devise ?? "USD";
  const bc = {
    id: "bc1", numero: "018/PEF/SO/AOÛT/26", date: new Date("2026-08-26T00:00:00Z"), statut: "VALIDE", devise,
    totalUSD: devise === "USD" ? lignes.length * 17.5 : null, totalCDF: devise === "CDF" ? lignes.length * 49000 : null,
    delaiPaiement: "30 jours", modePaiement: "Espèces", lignes,
  } as unknown as BonDeCommande & { lignes: LigneBonDeCommande[] };
  return renderPdfBuffer(BonCommandeDocument({
    bc: bc as never,
    fournisseur: (opts.fournisseur === undefined ? { nom: "SO GOOD" } : opts.fournisseur) as Fournisseur | null,
    acheteur: (opts.acheteur ?? null) as ParametresAchat | null,
    societe: opts.societe, achats: opts.achats,
  }));
}

const deposer = (nom: string, pdf: Buffer) => {
  const d = process.env.PDF_ECHANTILLONS;
  if (d) { fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, nom), pdf); }
};
const texte = async (pdf: Buffer) => (await pagesDuPdf(pdf)).map((p) => p.plat).join(" ");
const COLONNES = ["Désignation", "Nbre d'unités par paquet/carton", "Nbre de cartons", "Quantité", "Unité", "P.U. (USD)", "Total (USD)"];

describe("bon de commande — en-tête de colonnes sur chaque page du tableau", () => {
  it("45 lignes : 2 pages, l'en-tête de colonnes est en page 1 ET en page 2", async () => {
    const pdf = await rendre(Array.from({ length: 45 }, (_, i) => ligne(i)));
    deposer("bon-commande-45-lignes.pdf", pdf);
    const pages = await pagesDuPdf(pdf);
    expect(pages.length).toBeGreaterThanOrEqual(2);
    for (const [i, p] of pages.entries()) {
      if (!/Article \d+/.test(p.plat)) continue; // page sans ligne : rien à légender
      for (const col of ["Désignation", "Quantité", "Unité", "Total (USD)"]) expect(p.plat, `page ${i + 1}, colonne « ${col} »`).toContain(col);
    }
    expect(pages[1].plat).toMatch(/Article 4[0-5]/); // la page 2 porte bien des lignes
  }, 60_000);

  it("10 lignes : une seule page, l'en-tête n'est pas dupliqué", async () => {
    const pdf10 = await rendre(Array.from({ length: 10 }, (_, i) => ligne(i)));
    deposer("bon-commande-10-lignes.pdf", pdf10);
    const pages = await pagesDuPdf(pdf10);
    expect(pages).toHaveLength(1);
    expect(pages[0].plat.split("Désignation").length - 1).toBe(1);
  }, 60_000);
});

describe("bon de commande — colonnes du modèle (sans « Référence »)", () => {
  it("toutes les colonnes sont là, dans l'ordre ; AUCUNE colonne Référence", async () => {
    const t = await texte(await rendre([ligne(0)]));
    let depuis = 0;
    for (const c of COLONNES) {
      const i = t.indexOf(c, depuis);
      expect(i, `colonne « ${c} » absente ou hors ordre`).toBeGreaterThanOrEqual(0);
      depuis = i + c.length;
    }
    expect(t).not.toMatch(/R[ée]f[ée]rence/i);
    expect(t).not.toMatch(/\bR[ée]f\b/i);
  }, 60_000);

  it("ligne : unités par carton et unité lues sur la ligne ; à défaut sur l'article ; « — » si absentes (jamais 0)", async () => {
    const t = await texte(await rendre([
      ligne(0, { designation: "Penne", uniteParCarton: 24 as never, unite: "Pièce" }),
      ligne(1, { designation: "Sirop", uniteParCarton: null, unite: null, article: { contenance: null, contenanceUnite: null, unite: "Bouteille", uniteParCarton: "6" } }),
      ligne(2, { designation: "Libre", uniteParCarton: null, unite: null, nbCartons: null }),
    ]));
    expect(t).toMatch(/Penne 24 2 10 Pièce/);
    expect(t).toMatch(/Sirop 6 2 10 Bouteille/);
    expect(t).toMatch(/Libre — — 10 —/);
  }, 60_000);

  it("bon en francs : prix et total en FC, colonnes en FC, jamais de « $ » dans le tableau", async () => {
    const pdf = await rendre(
      [ligne(0, { designation: "Huile", prixUnitaireUSD: null, totalLigneUSD: null, prixUnitaireCDF: 4900 as never, totalLigneCDF: 49000 as never, unite: "L" })],
      { devise: "CDF" },
    );
    deposer("bon-commande-francs.pdf", pdf);
    const t = await texte(pdf);
    expect(t).toContain("P.U. (CDF)");
    expect(t).toMatch(/Huile 5 2 10 L 4 900 FC 49 000 FC/);
    expect(t).toMatch(/TOTAL 49 000 FC/);
    // (le pied de page porte « 25 US$ », compte Ecobank : on ne regarde que du tableau au total)
    expect(t.slice(t.indexOf("Désignation"), t.indexOf("CONDITIONS"))).not.toContain("$");
    expect(policesDeRepli(pdf)).toEqual([]);
  }, 60_000);
});

describe("bon de commande — blocs fournisseur et acheteur", () => {
  it("fournisseur : Adresse et ID National imprimés ; « — » quand absents", async () => {
    const plein = await texte(await rendre([ligne(0)], { fournisseur: { nom: "REGAL", adresse: "12 avenue du Port", idNational: "01-910-N123", ville: "Kinshasa", pays: "République démocratique du Congo" } }));
    expect(plein).toContain("Adresse 12 avenue du Port");
    expect(plein).toContain("ID National 01-910-N123");
    const vide = await texte(await rendre([ligne(0)], { fournisseur: { nom: "REGAL" } }));
    expect(vide).toMatch(/FOURNISSEUR Nom REGAL Adresse — Ville — Pays — Téléphone — ID National — RCCM — Contact —/);
  }, 60_000);

  it("acheteur : Pays, Contact et Adresse de livraison lus dans les informations de la société — jamais en dur", async () => {
    const societe = { nom: "TOLYA SARL", adresse: "31, avenue Comité Urbain", pays: "République Démocratique du Congo", telephone: "+243 83 000 34 23", rccm: "CD/KNG/RCCM/18-B-01373", idNat: "01-F4300-N74832J", lieuTravail: "10, avenue Wagenia - CTC Mall" };
    const t = await texte(await rendre([ligne(0)], { societe, achats: { adresseLivraison: null, contact: "Mme Dupont" } }));
    expect(t).toContain("Adresse de livraison 10, avenue Wagenia - CTC Mall"); // repli : le restaurant
    expect(t).toContain("Pays République Démocratique du Congo");
    expect(t).toContain("Contact Mme Dupont");
    expect(t).toContain("ID National 01-F4300-N74832J");
    const livre = await texte(await rendre([ligne(0)], { societe, achats: { adresseLivraison: "Entrepôt de la Gombe", contact: null } }));
    expect(livre).toContain("Adresse de livraison Entrepôt de la Gombe");
    // Sans aucune information de société : « — », rien d'inventé.
    const rien = await texte(await rendre([ligne(0)]));
    expect(rien).toMatch(/ACHETEUR Nom TOLYA SARL Adresse — Adresse de livraison — Ville — Pays — Téléphone — ID National — RCCM — Contact —/);
  }, 60_000);

  it("acheteurDuBon : une valeur des paramètres d'achat l'emporte sur la société ; vide = absent", () => {
    const a = acheteurDuBon({ acheteurNom: "TOLYA SARL", acheteurAdresse: "Siège A", acheteurVille: null, acheteurPays: null, acheteurIdNational: null, acheteurRccm: "  ", acheteurTelephone: null, acheteurContact: "Paul" },
      { nom: "X", adresse: "Siège B", pays: "RDC", telephone: "1", rccm: "R", idNat: "N", lieuTravail: "Resto" }, { adresseLivraison: null, contact: "Autre" });
    expect(a).toMatchObject({ adresse: "Siège A", pays: "RDC", rccm: "R", idNational: "N", contact: "Paul", adresseLivraison: "Resto", ville: null });
  });
});

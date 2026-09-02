import { describe, it, expect } from "vitest";
import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { Document, Page, Text } from "@react-pdf/renderer";
import type { BonDeCommande, LigneBonDeCommande, Fournisseur } from "@prisma/client";
import { formaterNombre, formaterUSD, formaterFC } from "@/lib/montant";
import { renderPdfBuffer } from "./fonts";
import { formatCDF, formatMontant } from "./theme";
import { BonCommandeDocument } from "./bon-commande";

/**
 * Garde-fou GLYPHES MANQUANTS — défaut constaté sur le bon de commande 018/PEF/SO/AOÛT/26
 * (26/08/2026) : le total « 1 049,76 $ » sortait imprimé avec une barre en travers du 0.
 *
 * Cause : `toLocaleString("fr-FR")` sépare les milliers par une ESPACE FINE INSÉCABLE (U+202F)
 * depuis ICU 72 (Node ≥ 18.13). Optima, la police embarquée dans nos PDF, n'a aucun glyphe pour
 * ce caractère ; react-pdf se rabat alors sur une police standard PDF (Helvetica) qui dessine à
 * la place une barre oblique collée au chiffre suivant. Tout montant ≥ 1 000 était donc « barré »,
 * sur les bons de commande comme sur les bulletins, contrats, attestations et rapports.
 *
 * Les tests ci-dessous relisent le PDF PRODUIT : un document dont tout le texte tient dans
 * Optima n'embarque QUE des sous-ensembles Optima (préfixés « ABCDEF+ »). Dès qu'un caractère
 * manque, une police standard non embarquée apparaît — quelle qu'en soit la cause.
 */

/** Polices déclarées dans un PDF (nom /BaseFont). */
function policesDuPdf(pdf: Buffer): string[] {
  return [...pdf.toString("latin1").matchAll(/\/BaseFont\s*\/([A-Za-z0-9+\-_,]+)/g)].map((m) => m[1]);
}

/** Une police EMBARQUÉE est un sous-ensemble, donc préfixée de 6 lettres et d'un « + ». */
const estEmbarquee = (nom: string) => /^[A-Z]{6}\+/.test(nom);

/**
 * Suite des identifiants de glyphes réellement dessinés dans les flux de contenu.
 * Sert d'empreinte du texte composé : deux documents au texte différent ont deux empreintes
 * différentes, ce qui permet de vérifier qu'une donnée atteint bien la page.
 */
function glyphesDessines(pdf: Buffer): string {
  const glyphes: string[] = [];
  let curseur = 0;
  for (;;) {
    const debut = pdf.indexOf("stream", curseur);
    if (debut === -1) break;
    const fin = pdf.indexOf("endstream", debut);
    if (fin === -1) break;
    // Reprendre APRÈS le mot-clé de fin : « endstream » contient « stream », et repartir avant
    // sa fin ferait chevaucher deux flux (le contenu texte passerait alors inaperçu).
    curseur = fin + "endstream".length;
    let d = debut + "stream".length;
    if (pdf[d] === 0x0d) d++;
    if (pdf[d] === 0x0a) d++;
    let contenu: string;
    try {
      contenu = zlib.inflateSync(pdf.subarray(d, fin)).toString("latin1");
    } catch {
      continue; // flux non compressé (police, image…) : sans intérêt ici
    }
    for (const ligne of contenu.split("\n")) {
      if (!/\b(TJ|Tj)\b/.test(ligne)) continue;
      for (const chaine of ligne.matchAll(/<([0-9a-fA-F]+)>/g)) glyphes.push(chaine[1]);
    }
  }
  return glyphes.join(" ");
}

function bcFictif(totalUSD: number): Parameters<typeof BonCommandeDocument>[0]["bc"] {
  const ligne = {
    id: "l1",
    bonDeCommandeId: "bc1",
    designation: "Penne Rigate 24 X 500G",
    quantite: 1200,
    nbCartons: 50,
    prixUnitaireUSD: 1.75,
    totalLigneUSD: totalUSD,
  } as unknown as LigneBonDeCommande;
  return {
    id: "bc1",
    numero: "018/PEF/SO/AOÛT/26",
    date: new Date("2026-08-26T00:00:00Z"),
    statut: "VALIDE",
    totalUSD,
    delaiPaiement: "30 jours",
    modePaiement: "Espèces",
    lignes: [ligne],
  } as unknown as BonDeCommande & { lignes: LigneBonDeCommande[] };
}

const rendreBc = (totalUSD: number) =>
  renderPdfBuffer(
    BonCommandeDocument({
      bc: bcFictif(totalUSD),
      fournisseur: { nom: "SO GOOD", ville: "Kinshasa" } as unknown as Fournisseur,
      acheteur: null,
    }),
  );

describe("glyphes manquants dans les PDF", () => {
  it("le bon de commande n'embarque qu'Optima (aucun repli sur une police standard)", async () => {
    // Total ≥ 1 000 : c'est LE cas qui fait apparaître le séparateur de milliers.
    const pdf = await rendreBc(2100);
    const polices = policesDuPdf(pdf);
    expect(polices.length).toBeGreaterThan(0); // le PDF a bien été lu
    expect(polices.filter((p) => !estEmbarquee(p))).toEqual([]);
  }, 30000);

  it("le montant du jeu d'essai atteint bien la page", async () => {
    // Sans ce contrôle, un jeu d'essai aux mauvais noms de champs afficherait « NaN $ » — et le
    // test précédent passerait au vert sans jamais avoir composé un montant à quatre chiffres.
    const [aQuatreChiffres, aTroisChiffres] = await Promise.all([rendreBc(2100), rendreBc(999)]);
    expect(glyphesDessines(aQuatreChiffres)).not.toBe(glyphesDessines(aTroisChiffres));
  }, 30000);

  it("le détecteur voit bien le défaut d'origine (espace fine insécable brute)", async () => {
    const brut = (1049.76).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    expect(brut).toContain(" "); // ICU produit bien l'espace fine insécable
    const doc = React.createElement(
      Document,
      null,
      React.createElement(
        Page,
        { size: "A4", style: { fontFamily: "Optima", padding: 40 } },
        React.createElement(Text, null, `${brut} $`),
      ),
    );
    const pdf = await renderPdfBuffer(doc);
    expect(policesDuPdf(pdf).filter((p) => !estEmbarquee(p)).length).toBeGreaterThan(0);
  }, 30000);
});

describe("couverture des formateurs par la police Optima", () => {
  // Tous les formateurs partagés, sur des valeurs ≥ 1 000 (le seul cas qui produit un séparateur).
  const textes = [
    formaterNombre(1049.76, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    formaterNombre(1234567),
    formaterUSD(1049.76),
    formaterFC(1250000),
    formatCDF(1250000),
    formatMontant(1049.76, "USD", 2800),
    formatMontant(1049.76, "CDF", 2800),
  ];

  it("leurs sorties se composent en Optima dans les trois graisses", async () => {
    const graisses = [
      { fontWeight: 400 as const },
      { fontWeight: 700 as const },
      { fontStyle: "italic" as const },
    ];
    const doc = React.createElement(
      Document,
      null,
      React.createElement(
        Page,
        { size: "A4", style: { fontFamily: "Optima", padding: 40 } },
        ...graisses.flatMap((style, i) =>
          textes.map((texte, j) =>
            React.createElement(Text, { key: `${i}-${j}`, style }, texte),
          ),
        ),
      ),
    );
    const pdf = await renderPdfBuffer(doc);
    expect(policesDuPdf(pdf).filter((p) => !estEmbarquee(p))).toEqual([]);
  }, 30000);
});

/**
 * Aide-mémoire, PAS la garantie : ce contrôle de source ne voit que les fichiers de `lib/pdf/`
 * et ceux qui mentionnent `@/lib/pdf/`. Un module de formatage partagé (par exemple
 * `src/lib/stock.ts`, aujourd'hui réservé aux écrans) consommé indirectement par une route PDF
 * lui échapperait. La vraie garantie reste le contrôle des polices sur le PDF produit, plus haut :
 * c'est lui qui voit le défaut, quelle qu'en soit la provenance.
 */
describe("règle de formatage des nombres destinés aux PDF", () => {
  it('aucun module touchant aux PDF n\'appelle toLocaleString("fr-FR") en direct', () => {
    const racine = path.join(process.cwd(), "src");
    const fichiers: string[] = [];
    const parcourir = (dossier: string) => {
      for (const entree of fs.readdirSync(dossier, { withFileTypes: true })) {
        const chemin = path.join(dossier, entree.name);
        if (entree.isDirectory()) parcourir(chemin);
        else if (/\.tsx?$/.test(entree.name) && !/\.test\.tsx?$/.test(entree.name)) fichiers.push(chemin);
      }
    };
    parcourir(racine);

    const fautifs = fichiers.filter((chemin) => {
      const source = fs.readFileSync(chemin, "utf8");
      const toucheAuxPdf =
        chemin.includes(`${path.sep}lib${path.sep}pdf${path.sep}`) || source.includes("@/lib/pdf/");
      return toucheAuxPdf && source.includes('toLocaleString("fr-FR"');
    });

    expect(
      fautifs.map((f) => path.relative(process.cwd(), f)),
      'utiliser formaterNombre() de @/lib/montant : toLocaleString("fr-FR") produit une espace fine insécable absente de la police Optima',
    ).toEqual([]);
  });
});

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { BulletinsValidation } from "./bulletins-validation";
import type { PaieRow } from "./paie-bulk";
import { LBL_BULLETIN } from "@/lib/bulletin-format";
import { formaterNombre } from "@/lib/montant";

// La carte mobile de la paie (Direction) omettait l'échéance de prêt, que le bulletin PDF affiché
// sur ordinateur imprime : les lignes de l'aperçu ne s'additionnaient plus au salaire net dès qu'un
// salarié remboursait un prêt (relecture du 2026-09-28).

const ligne = (p: Partial<PaieRow>): PaieRow => ({
  id: "l1",
  employeeId: "e1",
  matricule: "PEF-001",
  nom: "Martine Mutombo",
  photoUrl: null,
  categorie: "BRIGADE",
  // brut imposable 300 − CNSS 15 − IPR 10 − acompte 0 − prêt 25 = net 250 ; + transport 20 = versé 270
  salBrutUSD: 320,
  salaireNetUSD: 250,
  salaireNetCDF: 250 * 2800,
  totalVerseUSD: 270,
  statutPaiement: "VALIDE",
  modePaiementDefaut: "ESPECES",
  baseUSD: 300,
  hsUSD: 0,
  transportUSD: 20,
  primesUSD: 0,
  allocUSD: 0,
  fraisMedUSD: 0,
  cnssUSD: 15,
  iprUSD: 10,
  acompteUSD: 0,
  retenuePretUSD: 25,
  sourceReference: "CONTRAT",
  motifReference: null,
  avertissements: [],
  ...p,
});

const rendu = (r: PaieRow) => renderToStaticMarkup(<BulletinsValidation rows={[r]} role="VIEWER" />);
const texte = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const montant = (n: number) => formaterNombre(n, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " $";

describe("carte mobile de la paie : l'échéance de prêt", () => {
  it("s'affiche en retenue (même libellé que le bulletin, même format que l'acompte)", () => {
    const t = texte(rendu(ligne({})));
    expect(t).toContain(`${LBL_BULLETIN.pret} − ${montant(25)}`);
  });

  it("rien si zéro — comme l'acompte", () => {
    const t = texte(rendu(ligne({ retenuePretUSD: 0, salaireNetUSD: 275, totalVerseUSD: 295 })));
    expect(t).not.toContain(LBL_BULLETIN.pret);
  });

  it("le libellé est celui que le bulletin PDF imprime", () => {
    const pdf = readFileSync(path.resolve(__dirname, "../../../lib/pdf/bulletin.tsx"), "utf8");
    expect(pdf).toContain(`designation="${LBL_BULLETIN.pret}"`);
  });

  it("l'aperçu du bulletin de la fiche employé emploie le libellé commun", () => {
    const apercu = readFileSync(path.resolve(__dirname, "../employes/[id]/apercu-bulletin.tsx"), "utf8");
    expect(apercu).toMatch(/label=\{L\.pret\}/);
    expect(apercu).not.toMatch(/"Retenue prêt/);
  });
});

import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { HeuresTravailleesCard, referenceHeuresCarte } from "./fiche-cards";

// La jauge « Heures travaillées » de la fiche ne doit pas contredire l'aperçu du bulletin affiché
// juste en dessous (revue finale du 2026-09-24, point 3). Martine Mutombo, septembre 2026 : contrat
// 54 h/sem (234 h/mois), 216 h planifiées, toutes faites, net entier. Avant : « 216 h / 234 h, solde
// −18 h » en rouge au-dessus de « Heures planifiées 216 h ».
const CONTRAT_MARTINE = (54 * 52) / 12; // 234
const carte = (heuresTravaillees: number, ref: { heures: number; libelle: string | null }) =>
  renderToStaticMarkup(
    <HeuresTravailleesCard periode="septembre 2026" heuresTravaillees={heuresTravaillees} heuresContractuelles={ref.heures} libelleReference={ref.libelle} heuresSupp={0} />,
  );
const texte = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("jauge d'heures de la fiche", () => {
  it("brigade sur heures planifiées : référence de la paie et son libellé, solde nul, rien en rouge", () => {
    const ref = referenceHeuresCarte({ categorie: "BRIGADE", heuresMoisContrat: CONTRAT_MARTINE, reference: { source: "PLANNING", heuresReference: 216 } });
    expect(ref).toEqual({ heures: 216, libelle: "Heures planifiées" });
    const html = carte(216, ref);
    expect(texte(html)).toContain("216h / 216h Heures planifiées");
    expect(texte(html)).toContain("Solde +0h");
    expect(html).not.toContain("text-red-600");
    expect(texte(html)).not.toContain("234");
  });

  it("brigade en repli sur le contrat : heures du contrat, libellé du repli", () => {
    const ref = referenceHeuresCarte({ categorie: "BRIGADE", heuresMoisContrat: 208, reference: { source: "CONTRAT_REPLI", heuresReference: 208 } });
    expect(texte(carte(200, ref))).toContain("200h / 208h Heures contrat (repli)");
  });

  it("hors brigade : comportement d'avant (contrat arrondi à l'heure, sans libellé), même avec un aperçu", () => {
    const ref = referenceHeuresCarte({ categorie: "BACKOFFICE", heuresMoisContrat: 173.33, reference: { source: "CONTRAT", heuresReference: 173.33 } });
    expect(ref).toEqual({ heures: 173, libelle: null });
    expect(texte(carte(160, ref))).toContain("160h / 173h Normales");
  });

  it("brigade sans aperçu : comportement d'avant", () => {
    expect(referenceHeuresCarte({ categorie: "BRIGADE", heuresMoisContrat: CONTRAT_MARTINE, reference: null })).toEqual({ heures: 234, libelle: null });
  });

  it("la fiche passe bien par referenceHeuresCarte (jamais le contrat en direct)", () => {
    const page = fs.readFileSync(path.join(__dirname, "page.tsx"), "utf8");
    const bloc = page.slice(page.indexOf("<HeuresTravailleesCard"), page.indexOf("/>", page.indexOf("<HeuresTravailleesCard")));
    expect(page).toMatch(/referenceHeuresCarte\(\{ categorie: employee\.categorie, heuresMoisContrat, reference: apercuBulletin\.reference \}\)/);
    expect(bloc).toContain("heuresContractuelles={ref.heures}");
    expect(bloc).toContain("libelleReference={ref.libelle}");
  });
});

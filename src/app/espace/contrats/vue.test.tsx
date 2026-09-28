import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { VueMesContrats, rubriquesContrats, type LigneContrat } from "./vue";
import { texteSignature } from "@/components/bouton-signer";

// « Mes contrats » : trois rubriques dans cet ordre (À signer, En vigueur, Anciens), un état vide
// qui se dit, et le type de contrat EN CLAIR — aucune valeur brute d'enum ne doit atteindre l'écran
// du salarié (« STAGE », « ACTIF », « TRANSFORME »…).

const jour = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const ligne = (p: Partial<LigneContrat> & { id: string }): LigneContrat => ({
  type: "CDI",
  poste: "Cuisinière",
  dateDebut: jour("2026-01-01"),
  dateFin: null,
  classement: { categorie: "EN_VIGUEUR", motif: null, expireNonMarque: false },
  etat: { etat: "SIGNE", signeLeTexte: "02/01/2026" },
  ...p,
});
const action = async () => undefined;
const rendu = (lignes: LigneContrat[]) =>
  renderToStaticMarkup(<VueMesContrats lignes={lignes} nomSalarie="Awa Test" action={action} />);
const texte = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const aSigner = ligne({
  id: "s",
  type: "CDD",
  dateFin: jour("2026-12-31"),
  classement: { categorie: "A_SIGNER", motif: null, expireNonMarque: false },
  etat: { etat: "A_SIGNER", signeLeTexte: null },
});
const enVigueur = ligne({ id: "v" });
const ancien = ligne({
  id: "a",
  type: "STAGE",
  dateDebut: jour("2025-01-01"),
  dateFin: jour("2025-06-30"),
  classement: { categorie: "ANCIEN", motif: "transformé", expireNonMarque: false },
});

describe("rubriquesContrats", () => {
  it("range chaque contrat dans sa rubrique", () => {
    const r = rubriquesContrats([ancien, enVigueur, aSigner]);
    expect(r.aSigner.map((l) => l.id)).toEqual(["s"]);
    expect(r.enVigueur.map((l) => l.id)).toEqual(["v"]);
    expect(r.anciens.map((l) => l.id)).toEqual(["a"]);
  });
});

describe("VueMesContrats", () => {
  it("les trois rubriques, dans l'ordre À signer → En vigueur → Anciens", () => {
    const t = texte(rendu([ancien, enVigueur, aSigner]));
    const i = (s: string) => t.indexOf(s);
    expect(i("À signer")).toBeGreaterThanOrEqual(0);
    expect(i("À signer")).toBeLessThan(i("En vigueur"));
    expect(i("En vigueur")).toBeLessThan(i("Anciens"));
  });

  it("chaque rubrique vide annonce son état", () => {
    const t = texte(rendu([]));
    expect(t).toContain("Aucun contrat à signer");
    expect(t).toContain("Aucun contrat en vigueur");
    expect(t).toContain("Aucun ancien contrat");
  });

  it("type en clair, jamais une valeur brute d'enum", () => {
    const t = texte(rendu([ancien, enVigueur, aSigner]));
    expect(t).toContain("CDI — durée indéterminée");
    expect(t).toContain("CDD — durée déterminée");
    expect(t).toContain("Stage");
    for (const brut of ["STAGE", "ACTIF", "TRANSFORME", "RESILIE", "EXPIRE", "A_SIGNER", "EN_VIGUEUR", "ANCIEN"]) {
      expect(t).not.toMatch(new RegExp(`\\b${brut}\\b`));
    }
  });

  it("le contrat à signer porte le bouton Signer ; un ancien jamais", () => {
    const html = rendu([aSigner]);
    expect(texte(html)).toMatch(/\bSigner\b/);
    const seulAncien = texte(rendu([ancien]));
    expect(seulAncien).not.toMatch(/\bSigner\b/);
    expect(seulAncien).toContain("transformé");
  });

  it("en vigueur : « Signé le … » et l'exemplaire à télécharger", () => {
    const t = texte(rendu([enVigueur]));
    expect(t).toContain("Signé le 02/01/2026");
    expect(t).toContain("Télécharger");
  });

  it("un ancien se télécharge dans son exemplaire figé", () => {
    expect(rendu([ancien])).toContain("/espace/contrat/a?dl=1&amp;exemplaire=fige");
  });
});

describe("pièce jointe du contrat", () => {
  it("le lien vers la pièce jointe déposée par la Direction est proposé, dans chaque rubrique", () => {
    for (const l of [aSigner, enVigueur, ancien]) {
      const html = rendu([{ ...l, documentUrl: "/fichiers/documents/scan-1.pdf" }]);
      expect(html).toContain('href="/fichiers/documents/scan-1.pdf"');
      expect(texte(html)).toContain("pièce jointe");
    }
    expect(rendu([aSigner])).not.toContain("pièce jointe");
  });
});

describe("fenêtre de signature", () => {
  it("un CONTRAT signé par le salarié vaut acceptation — et le texte le dit", () => {
    expect(texteSignature("CONTRAT", "SALARIE")).toBe("En signant, vous acceptez ce contrat et ses conditions.");
  });
  it("les autres documents gardent leur formulation", () => {
    expect(texteSignature("BULLETIN", "SALARIE")).toBe("En signant, vous reconnaissez avoir pris connaissance de ce document.");
    expect(texteSignature("DEMANDE_CONGE", "SALARIE")).toBe("En signant, vous reconnaissez avoir pris connaissance de ce document.");
  });
});

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isValidElement, type ReactNode } from "react";
import { messageConfirmationValidation, MAX_SALARIES_CONFIRMATION, lignesAValiderDuLot } from "./avertissements-validation";
import { StatusActions } from "./status-actions";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { BadgeReference, ListeAvertissements } from "./avertissements-paie";
import { LIBELLE_SOURCE_REFERENCE } from "@/lib/paie-reference-libelles";
import type { AvertissementPaie } from "@/lib/paie-reference";

const RACHEL = { nom: "Rachel Lunda", avertissements: [{ code: "PRESENCE_SANS_CRENEAU" as const, message: "Travail hors planning (2 j) : 28/09, 30/09" }] };
const MARTINE = { nom: "Martine Mutombo", avertissements: [] };

describe("messageConfirmationValidation", () => {
  it("rien à signaler → null (validation directe, sans boîte)", () => {
    expect(messageConfirmationValidation([MARTINE])).toBeNull();
    expect(messageConfirmationValidation([])).toBeNull();
  });
  it("liste chaque avertissement avec le nom, et laisse valider", () => {
    expect(messageConfirmationValidation([MARTINE, RACHEL])).toBe(
      "Avant de valider (la validation reste possible) :\n\n• Rachel Lunda — Travail hors planning (2 j) : 28/09, 30/09\n\nValider quand même ?",
    );
  });
  it("liste longue : au plus une dizaine de salariés, puis « … et N autres », sans couper un message", () => {
    // Messages longs et distincts : un message coupé au milieu se verrait.
    const long = (i: number): AvertissementPaie => ({
      code: "PRESENCE_SANS_CRENEAU",
      message: `Travail hors planning (12 j) : ${Array.from({ length: 12 }, (_, k) => `${String(k + 1).padStart(2, "0")}/09`).join(", ")} — salarié ${i}`,
    });
    const lignes = Array.from({ length: 25 }, (_, i) => ({
      nom: `Salarié ${String(i + 1).padStart(2, "0")}`,
      // Le 1er salarié a deux avertissements : ils restent tous les deux, entiers.
      avertissements: i === 0 ? [long(i + 1), { code: "SAISIE_ANTICIPEE" as const, message: "Saisi d'avance (1 j) : 05/09" }] : [long(i + 1)],
    }));
    const msg = messageConfirmationValidation([MARTINE, ...lignes])!;
    expect(MAX_SALARIES_CONFIRMATION).toBe(10);
    const puces = msg.split("\n").filter((l) => l.startsWith("• "));
    // 10 salariés montrés (11 puces : le 1er en a deux), chaque message ENTIER.
    expect(new Set(puces.map((p) => p.split(" — ")[0])).size).toBe(10);
    expect(puces).toHaveLength(11);
    expect(puces[0]).toBe(`• Salarié 01 — ${long(1).message}`);
    expect(puces[1]).toBe("• Salarié 01 — Saisi d'avance (1 j) : 05/09");
    expect(puces[10]).toBe(`• Salarié 10 — ${long(10).message}`);
    expect(msg).not.toContain("Salarié 11 —");
    expect(msg).toContain("\n… et 15 autres salariés avec des avertissements\n");
    expect(msg.endsWith("\n\nValider quand même ?")).toBe(true);
  });
  it("exactement dix salariés : tous montrés, pas de « … et 0 autres »", () => {
    const lignes = Array.from({ length: 10 }, (_, i) => ({ nom: `S${i}`, avertissements: RACHEL.avertissements }));
    const msg = messageConfirmationValidation(lignes)!;
    expect(msg.split("\n").filter((l) => l.startsWith("• "))).toHaveLength(10);
    expect(msg).not.toContain("autre");
  });
  it("onze salariés : « … et 1 autre salarié » (singulier)", () => {
    const lignes = Array.from({ length: 11 }, (_, i) => ({ nom: `S${i}`, avertissements: RACHEL.avertissements }));
    expect(messageConfirmationValidation(lignes)).toContain("\n… et 1 autre salarié avec des avertissements\n");
  });
});

describe("BadgeReference", () => {
  it("rien quand la ligne est sur le planning sans avertissement", () => {
    expect(renderToStaticMarkup(BadgeReference({ sourceReference: "PLANNING", motifReference: null, avertissements: [] }))).toBe("");
  });
  it("rien non plus pour l'ancienne règle (heures / mois du contrat)", () => {
    expect(renderToStaticMarkup(BadgeReference({ sourceReference: "CONTRAT", motifReference: null, avertissements: [] }))).toBe("");
  });
  it("repli : badge au libellé partagé, motif en infobulle, sans le compter deux fois", () => {
    const html = renderToStaticMarkup(BadgeReference({ sourceReference: "CONTRAT_REPLI", motifReference: "Planning incomplet : semaine du 21/09 sans créneau",
      avertissements: [{ code: "REPLI_CONTRAT", message: "Heures contrat (repli) — Planning incomplet : semaine du 21/09 sans créneau" }] }));
    expect(html).toContain(LIBELLE_SOURCE_REFERENCE.CONTRAT_REPLI);
    expect(html).toContain('title="Planning incomplet : semaine du 21/09 sans créneau"');
    expect(html).not.toContain("⚠");
  });
  it("autres avertissements : « ⚠ n » et le détail en infobulle", () => {
    const html = renderToStaticMarkup(BadgeReference({ sourceReference: "PLANNING", motifReference: null, avertissements: RACHEL.avertissements }));
    expect(html).toContain("⚠ 1");
    expect(html).toContain("Travail hors planning (2 j) : 28/09, 30/09");
  });
  it("les badges peuvent passer à la ligne (jamais de largeur imposée sur mobile)", () => {
    const html = renderToStaticMarkup(BadgeReference({ sourceReference: "CONTRAT_REPLI", motifReference: "m", avertissements: RACHEL.avertissements }));
    expect(html).not.toMatch(/whitespace-nowrap|min-w-\[/);
  });
});

describe("ListeAvertissements", () => {
  it("rien quand il n'y a pas d'avertissement", () => {
    expect(renderToStaticMarkup(ListeAvertissements({ avertissements: [] }))).toBe("");
  });
  it("tous les messages en clair, repli compris, et retour à la ligne des longues listes (375 px)", () => {
    const html = renderToStaticMarkup(ListeAvertissements({ avertissements: [
      { code: "REPLI_CONTRAT", message: "Heures contrat (repli) — Planning incomplet" },
      ...RACHEL.avertissements,
    ] }));
    expect(html).toContain("<li>Heures contrat (repli) — Planning incomplet</li>");
    expect(html).toContain("<li>Travail hors planning (2 j) : 28/09, 30/09</li>");
    expect(html).toContain("break-words");
  });
});

describe("lignesAValiderDuLot", () => {
  const l = (id: string, statutPaiement: string) => ({ id, statutPaiement, nom: id, avertissements: RACHEL.avertissements });
  it("seulement les lignes cochées ET « pas validé » (une ligne payée n'est pas validée par le lot)", () => {
    const lignes = [l("a", "PAS_VALIDE"), l("b", "PAS_VALIDE"), l("c", "VALIDE"), l("d", "PAYE")];
    expect(lignesAValiderDuLot(lignes, new Set(["a", "c", "d"])).map((x) => x.id)).toEqual(["a"]);
  });
});

/** Tous les éléments React d'un arbre rendu par appel direct du composant (sans DOM). */
function elements(n: ReactNode): { type: unknown; props: Record<string, unknown> }[] {
  if (Array.isArray(n)) return n.flatMap(elements);
  if (!isValidElement(n)) return [];
  const props = n.props as Record<string, unknown>;
  return [{ type: n.type, props }, ...elements(props.children as ReactNode)];
}

describe("StatusActions : confirmation avant de valider une ligne", () => {
  const base = { payrollLineId: "l1", peutValider: true, nom: "Rachel Lunda" };
  const confirmations = (n: ReactNode) => elements(n).filter((e) => e.type === ConfirmSubmitButton);
  it("avec avertissements : le bouton Valider passe par la confirmation, message complet", () => {
    const c = confirmations(StatusActions({ ...base, statut: "PAS_VALIDE", avertissements: RACHEL.avertissements }));
    expect(c).toHaveLength(1);
    expect(c[0].props.variante).toBe("valider");
    expect(c[0].props.message).toBe(messageConfirmationValidation([RACHEL]));
  });
  it("sans avertissement : validation directe, pas de boîte", () => {
    expect(confirmations(StatusActions({ ...base, statut: "PAS_VALIDE", avertissements: [] }))).toHaveLength(0);
  });
  it("paiement et réouverture : jamais de rappel des avertissements", () => {
    expect(confirmations(StatusActions({ ...base, statut: "VALIDE", avertissements: RACHEL.avertissements }))).toHaveLength(0);
    expect(confirmations(StatusActions({ ...base, statut: "PAYE", avertissements: RACHEL.avertissements }))).toHaveLength(0);
  });
});

// Le lot (barre d'actions groupées) et la clôture passent aussi par la confirmation. Composants à
// état (lot) ou serveur (clôture) : vérifiés sur la source, faute de DOM dans ce dépôt.
describe("lot et clôture : la confirmation est câblée", () => {
  const src = (f: string) => readFileSync(join(__dirname, f), "utf8");
  it("lot : validation → avertissements des lignes à valider, sur toutes les lignes, puis window.confirm", () => {
    const s = src("paie-bulk.tsx");
    expect(s).toContain("messageConfirmationValidation(lignesAValiderDuLot([...brigade, ...backoffice], selection))");
    expect(s).toMatch(/if \(versStatut === "VALIDE"\) \{\s*const message = [^\n]+\n\s*if \(message && !window\.confirm\(message\)\) return;/);
  });
  it("clôture : le message rappelle les avertissements des « pas validé »", () => {
    const s = src("page.tsx");
    expect(s).toContain('messageConfirmationValidation(rows.filter((r) => r.statutPaiement === "PAS_VALIDE"))');
    expect(s).toMatch(/« pas validé ».\$\{avertissementsCloture \? `\\n\\n\$\{avertissementsCloture\}` : ""\}`/);
  });
});

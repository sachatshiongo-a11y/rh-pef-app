import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// L'action de signature importe la base : neutralisée, l'écran n'en appelle aucune au rendu.
vi.mock("../../signature-actions", () => ({ faireSignerDocument: vi.fn() }));
vi.mock("../../paie/correction-paiement-actions", () => ({ corrigerPaiementBulletin: vi.fn() }));

import { HistoriquePaie, type LigneHistoriquePaie } from "./historique-paie";

const A_SIGNER = { etat: "A_SIGNER", signeLeTexte: null } as const;
const ligne = (annee: number, mois: number, statutPaiement: LigneHistoriquePaie["statutPaiement"], over: Partial<LigneHistoriquePaie> = {}): LigneHistoriquePaie => ({
  id: `l-${annee}-${mois}`, annee, mois, statutPaiement, salNetUSD: 320, transportUSD: 20, taux: 2800, versions: [], signature: A_SIGNER, ...over,
});
const texte = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&nbsp;| | /g, " ").replace(/\s+/g, " ");
const rendu = (p: Partial<Parameters<typeof HistoriquePaie>[0]> & { lignes: LigneHistoriquePaie[] }) =>
  renderToStaticMarkup(<HistoriquePaie employeeId="e1" nomSalarie="Caprice Bokole" peutModifier annee={2026} anneeCourante={2026} page={1} par={50} {...p} />);

// Capture de la Direction (2026-10-12) : octobre, septembre payés, juillet « Pas validé », puis juin 2026 et 2025.
const LIGNES = [
  ligne(2026, 10, "PAYE"), ligne(2026, 9, "PAYE"), ligne(2026, 7, "PAS_VALIDE"), ligne(2026, 6, "PAYE"),
  ligne(2025, 12, "PAYE"), ligne(2025, 11, "VALIDE", { salNetUSD: 220, transportUSD: 20 }),
];

describe("historique de paie — filtre d'année", () => {
  it("par défaut : l'année en cours seule, ses pastilles dans l'ordre, l'année active marquée", () => {
    const html = rendu({ lignes: LIGNES });
    expect(html).toContain('href="/employes/e1?tab=paie&amp;annee=2025"');
    expect(html).toContain('href="/employes/e1?tab=paie&amp;annee=toutes"');
    expect(html).toMatch(/aria-current="page"[^>]*>2026 \(4\)/);
    expect(texte(html)).toContain("2026 (4) 2025 (2) Toutes (6)");
    expect(html).toContain("l-2026-10");
    expect(html).not.toContain("l-2025-12"); // l'autre année n'est pas dans le tableau
  });

  it("une année choisie : ses bulletins seulement, avec ses propres totaux", () => {
    const html = rendu({ lignes: LIGNES, annee: 2025 });
    expect(html).toContain("l-2025-12");
    expect(html).not.toContain("l-2026-10");
    expect(html).toMatch(/aria-current="page"[^>]*>2025 \(2\)/);
  });

  it("« Toutes » : un bloc par année, chacun avec ses totaux", () => {
    const html = rendu({ lignes: LIGNES, annee: "toutes" });
    expect(html).toContain('data-totaux-annee="2026"');
    expect(html).toContain('data-totaux-annee="2025"');
    expect(html.indexOf('data-totaux-annee="2026"')).toBeLessThan(html.indexOf('data-totaux-annee="2025"'));
  });

  it("l'année en cours sans bulletin reste proposée, avec un état vide qui le dit", () => {
    const html = rendu({ lignes: [ligne(2025, 12, "PAYE")] });
    expect(texte(html)).toContain("2026 (0) 2025 (1) Toutes (1)");
    expect(texte(html)).toContain("Aucun bulletin en 2026.");
  });

  it("aucune paie du tout : le message d'avant", () => {
    expect(texte(rendu({ lignes: [] }))).toContain("Aucune paie calculée pour cet employé pour le moment.");
  });
});

describe("historique de paie — totaux de l'année", () => {
  it("salaire net $, net CDF, total versé, bulletins payés / validés / non validés ; le non validé n'est pas additionné", () => {
    const html = rendu({ lignes: LIGNES });
    const bloc = texte(html.slice(html.indexOf('data-totaux-annee="2026"')));
    // 3 bulletins comptés (octobre, septembre, juin) : net 300 $ chacun, versé 320 $, 300 × 2 800 = 840 000 CDF.
    expect(bloc).toContain("Salaire net $ 900,00 $");
    expect(bloc).toContain("Salaire net CDF 2 520 000 CDF");
    expect(bloc).toContain("Total versé $ 960,00 $");
    expect(bloc).toContain("3 payés");
    expect(bloc).toContain("1 non validé");
    expect(bloc).toContain("un bulletin non validé est provisoire et n'est pas additionné");
  });

  it("2025 : un payé + un validé, aucun non validé", () => {
    const html = rendu({ lignes: LIGNES, annee: 2025 });
    const bloc = texte(html.slice(html.indexOf('data-totaux-annee="2025"')));
    expect(bloc).toContain("1 payé · 1 validé · 0 non validé");
    expect(bloc).toContain("Salaire net $ 500,00 $"); // 300 + 200
  });

  it("taux inconnu : le net en francs est « — », le dollar reste additionné", () => {
    const html = rendu({ lignes: [ligne(2026, 10, "PAYE"), ligne(2026, 9, "PAYE", { taux: 0 })] });
    const bloc = texte(html.slice(html.indexOf('data-totaux-annee="2026"')));
    expect(bloc).toContain("Salaire net CDF —");
    expect(bloc).toContain("Salaire net $ 600,00 $");
  });

  it("aucun bulletin validé dans l'année : « — » partout, jamais 0", () => {
    const html = rendu({ lignes: [ligne(2026, 7, "PAS_VALIDE")] });
    const bloc = texte(html.slice(html.indexOf('data-totaux-annee="2026"')));
    expect(bloc).toContain("Salaire net $ —");
    expect(bloc).toContain("Salaire net CDF —");
    expect(bloc).toContain("Total versé $ —");
    expect(bloc.split("Période")[0]).not.toMatch(/(^|\s)0,00 \$/);
  });
});

describe("historique de paie — colonnes et gestes d'avant", () => {
  it("Aperçu, $, CDF, Attestation (payé), signer ; « Pas validé » sans signature", () => {
    const html = rendu({ lignes: LIGNES });
    const payee = html.slice(html.indexOf("octobre 2026"), html.indexOf("septembre 2026"));
    expect(payee).toContain("Aperçu");
    expect(payee).toContain("/paie/bulletin/l-2026-10?devise=USD&amp;dl=1");
    expect(payee).toContain("/paie/bulletin/l-2026-10?devise=CDF&amp;dl=1");
    expect(texte(payee)).toContain("Attestation");
    expect(texte(html)).toContain("Pas validé");
  });

  it("un bulletin validé annonce l'attestation « après paiement »", () => {
    expect(texte(rendu({ lignes: LIGNES, annee: 2025 }))).toContain("Attestation : après paiement");
  });

  it("tableau normal : plus de défilement interne, la page défile", () => {
    const html = rendu({ lignes: LIGNES });
    expect(html).toContain("tableau-normal-xl");
    expect(html).not.toMatch(/max-h-|overflow-y-auto|overflow-auto/);
  });
});

describe("historique de paie — pagination", () => {
  const beaucoup = Array.from({ length: 60 }, (_, i) => ligne(2025 - Math.floor(i / 12), 12 - (i % 12), "PAYE"));
  it("« Toutes » sur 60 bulletins : 50 par page, barre partagée, liens qui gardent onglet et année", () => {
    const html = rendu({ lignes: beaucoup, annee: "toutes", anneeCourante: 2025 });
    expect(texte(html)).toContain("1–50 sur 60 bulletins");
    expect(html).toContain('href="/employes/e1?tab=paie&amp;annee=toutes&amp;page=2"');
    expect(html).not.toContain("l-2021-1\""); // la 60e ligne est sur la page 2
  });

  it("page 2 : les 10 dernières ; les totaux de l'année restent ceux de l'année ENTIÈRE, et l'écran le dit", () => {
    const html = rendu({ lignes: beaucoup, annee: "toutes", anneeCourante: 2025, page: 2 });
    expect(texte(html)).toContain("51–60 sur 60 bulletins");
    const bloc = texte(html.slice(html.indexOf('data-totaux-annee="2021"')));
    expect(bloc).toContain("Salaire net $ 3 600,00 $"); // 12 bulletins × 300 $, pas les seuls 10 de la page
    expect(bloc).toContain("12 payés");
    expect(bloc).toContain("Totaux de l'année entière");
  });

  it("peu de bulletins : pas de barre", () => {
    expect(rendu({ lignes: LIGNES })).not.toContain('data-pagination=""');
  });
});

describe("historique de paie — « Corriger le paiement » (Direction seule, bulletins payés)", () => {
  const PAYES = [
    ligne(2026, 10, "PAYE", { datePaiement: "2026-10-03", modePaiement: "VIREMENT" }),
    ligne(2026, 9, "VALIDE"),
    ligne(2026, 7, "PAS_VALIDE"),
    ligne(2026, 6, "PAYE", { datePaiement: "2026-06-30", modePaiement: "ESPECES" }),
  ];
  const nb = (html: string) => (html.match(/Corriger le paiement<\/button>/g) ?? []).length;

  it("la Direction : le bouton sur chaque bulletin PAYÉ (de tous les mois), jamais sur un validé ou non validé", () => {
    const html = rendu({ lignes: PAYES, annee: "toutes", peutCorrigerPaiement: true });
    expect(nb(html)).toBe(2);
    expect(html).toContain("Corriger le paiement — octobre 2026");
    expect(html).toContain("Corriger le paiement — juin 2026");
  });

  it("sans le droit (RH, consultation) : aucun bouton, mais la date et le moyen restent lisibles", () => {
    const html = rendu({ lignes: PAYES, annee: "toutes" });
    expect(nb(html)).toBe(0);
    expect(texte(html)).toContain("le 03/10/2026 · Virement");
    expect(texte(html)).toContain("le 30/06/2026 · Espèces");
  });
});

// ─── « Hors calcul » (Direction, 2026-10-12) : la fiche dit ce que l'écran Paie sait déjà ───────────────────────
// La règle n'est PAS redécidée ici : `idsLignesHorsCalcul` (paie-hors-calcul.ts) est appelée telle quelle, sur une
// base simulée à la main (lecture des salariés, contrats, runs et du mois courant), puis ses résultats alimentent
// `ligneHistoriquePaie` et l'écran — le même chemin que la page de la fiche.
import { ligneHistoriquePaie } from "./historique-paie";
import { idsLignesHorsCalcul } from "@/lib/paie-hors-calcul";

type Run = { statut: "BROUILLON" | "VALIDE"; mois: number; annee: number };
function baseSimulee(opts: { actif?: boolean; runs: Record<string, Run>; moisCourant: { moisCourant: number; anneeCourante: number } }) {
  return {
    employee: { findMany: async () => [{ id: "e1", actif: opts.actif ?? true, contrat: "CDI", dateEmbauche: null }] },
    contrat: { findMany: async () => [] },
    payrollLine: { findMany: async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.map((id) => ({ id, payrollRun: opts.runs[id] })) },
    config: { findUnique: async () => opts.moisCourant },
  } as never;
}
const BRUTE = (id: string, statut: "PAS_VALIDE" | "VALIDE" | "PAYE") => ({ id, employeeId: "e1", statutPaiement: statut });
const COURANT = { moisCourant: 10, anneeCourante: 2026 };

/** Comme la page : la règle décide, la fiche affiche. */
async function ligneDeFiche(id: string, mois: number, statut: "PAS_VALIDE" | "VALIDE" | "PAYE", db: ReturnType<typeof baseSimulee>) {
  const hors = await idsLignesHorsCalcul(db, [BRUTE(id, statut)]);
  const run = { mois, annee: 2026, tauxChangeUtilise: 2800 };
  return ligneHistoriquePaie(
    { id, statutPaiement: statut, salNetUSD: 320, transportUSD: 20, tauxChangeFige: null, payrollRun: run, versionsBulletin: [] },
    A_SIGNER,
    hors.has(id),
  );
}

describe("historique de paie — « Hors calcul »", () => {
  it("mois passé CLÔTURÉ + Pas validé (Caprice, juillet) : « Hors calcul », pas « Pas validé »", async () => {
    const db = baseSimulee({ runs: { j: { statut: "VALIDE", mois: 7, annee: 2026 } }, moisCourant: COURANT });
    const html = rendu({ lignes: [ligne(2026, 10, "PAYE"), await ligneDeFiche("j", 7, "PAS_VALIDE", db)] });
    expect(texte(html)).toContain("Hors calcul");
    expect(texte(html)).not.toContain("Pas validé");
    expect(html).toContain('title="Ne compte ni dans les totaux, ni dans les déclarations"');
    expect(html).toContain("bg-gray-100"); // neutre : ni alerte ambre, ni rouge
  });

  it("mois COURANT + Pas validé : reste « Pas validé » (c'est à valider, pas à part)", async () => {
    const db = baseSimulee({ runs: { c: { statut: "VALIDE", mois: 10, annee: 2026 } }, moisCourant: COURANT });
    const html = rendu({ lignes: [await ligneDeFiche("c", 10, "PAS_VALIDE", db)] });
    expect(texte(html)).toContain("Pas validé");
    expect(texte(html)).not.toContain("Hors calcul");
  });

  it("mois passé dont la paie n'est PAS clôturée : reste « Pas validé »", async () => {
    const db = baseSimulee({ runs: { b: { statut: "BROUILLON", mois: 8, annee: 2026 } }, moisCourant: COURANT });
    const html = rendu({ lignes: [await ligneDeFiche("b", 8, "PAS_VALIDE", db)] });
    expect(texte(html)).toContain("Pas validé");
  });

  it("salarié SORTI du calcul (fiche désactivée) : « Hors calcul », même sur le mois courant", async () => {
    const db = baseSimulee({ actif: false, runs: { c: { statut: "BROUILLON", mois: 10, annee: 2026 } }, moisCourant: COURANT });
    const html = rendu({ lignes: [await ligneDeFiche("c", 10, "PAS_VALIDE", db)] });
    expect(texte(html)).toContain("Hors calcul");
  });

  it("lignes validées et payées : inchangées, même dans un mois clôturé et pour un salarié sorti", async () => {
    const db = baseSimulee({
      actif: false,
      runs: { v: { statut: "VALIDE", mois: 7, annee: 2026 }, p: { statut: "VALIDE", mois: 6, annee: 2026 } },
      moisCourant: COURANT,
    });
    const v = await ligneDeFiche("v", 7, "VALIDE", db);
    const p = await ligneDeFiche("p", 6, "PAYE", db);
    expect([v.horsCalcul, p.horsCalcul]).toEqual([false, false]);
    const t = texte(rendu({ lignes: [v, p] }));
    expect(t).toContain("Validé");
    expect(t).toContain("Payé");
    expect(t).not.toContain("Hors calcul");
  });

  it("totaux : le décompte met les hors calcul à part, sans les additionner ; le non validé du mois courant reste « non validé »", () => {
    const html = rendu({
      lignes: [
        ligne(2026, 10, "PAYE"), ligne(2026, 9, "PAYE"),
        ligne(2026, 10, "PAS_VALIDE", { id: "courant" }),
        ligne(2026, 7, "PAS_VALIDE", { id: "juillet", horsCalcul: true }),
      ],
    });
    const bloc = texte(html.slice(html.indexOf('data-totaux-annee="2026"')));
    expect(bloc).toContain("2 payés · 1 non validé · 1 hors calcul");
    expect(bloc).toContain("Salaire net $ 600,00 $"); // 2 × 300 $, ni le non validé ni le hors calcul
    expect(bloc).toContain("Total versé $ 640,00 $");
    expect(bloc).toContain("un bulletin hors calcul ne compte pas");
  });

  it("aucun hors calcul : le décompte d'avant, sans mention", () => {
    const bloc = texte(rendu({ lignes: LIGNES }));
    expect(bloc).not.toContain("hors calcul");
  });
});

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// Non-régression de l'extraction des indicateurs de paie : l'accueil RH affiche, sur ce jeu de
// données, EXACTEMENT les chiffres qu'il affichait avant que le calcul quitte la page. Les valeurs
// attendues sont posées à la main (jamais recalculées par le code testé).
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
const A = vi.hoisted(() => ({ user: { id: "seed", role: "ADMIN", nom: "Sacha Test", email: "rh@pef.cd", accesStock: false, employeeId: null } }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));
vi.mock("@/lib/auth", () => ({ verifySession: async () => A.user, requireModule: () => {}, requireRole: () => {} }));
vi.mock("@/lib/alertes", () => ({ calculerAlertes: async () => [] }));

let prisma: PrismaClient;
let fermer: () => Promise<void>;

/** Texte rendu : balises retirées, entités décodées, espaces (insécables comprises) ramenées à une seule. */
const texte = (html: string) =>
  html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/[\s\u00a0\u202f]+/g, " ");

async function salarie(matricule: string, nom: string) {
  return prisma.employee.create({
    data: {
      matricule, nom, sexe: "F", etatCivil: "Célibataire", poste: "Test", secteur: "Salle",
      categorie: "BRIGADE", salaireMensuel: 300, dateEmbauche: new Date("2025-01-01"), contrat: "CDI",
    },
  });
}

async function paie(mois: number, annee: number, lignes: { employeeId: string; net: string; transport: string; cout: string; hs?: string; medical?: string }[]) {
  const run = await prisma.payrollRun.create({ data: { mois, annee, tauxChangeUtilise: 2800 } });
  for (const l of lignes) {
    await prisma.payrollLine.create({
      data: {
        payrollRunId: run.id, employeeId: l.employeeId,
        salBrutUSD: 0, cnssSalarieUSD: 0, netImposableUSD: 0, iprCalculeUSD: 0, allocFamilialeUSD: 0,
        salNetUSD: l.net, salNetCDF: 0, cnssPatronalUSD: 0, coutEmployeurUSD: l.cout, coutEmployeurCDF: 0,
        transportUSD: l.transport, hsValorisee: l.hs ?? "0", fraisMedicauxUSD: l.medical ?? "0",
      },
    });
  }
}

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  const u = await prisma.user.create({ data: { email: "rh@pef.cd", nom: "Sacha Test", role: "ADMIN" } });
  A.user.id = u.id;
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2800, anneeCourante: 2026, moisCourant: 9 } });
  const martine = await salarie("MK01-PEF", "Martine Kabila");
  const josue = await salarie("JM01-PEF", "Josué Mbala");
  // Août : nets 370,00 + 335,00 = 705,00 ; coût 450,00 + 450,00 = 900,00.
  await paie(8, 2026, [
    { employeeId: martine.id, net: "400.00", transport: "30.00", cout: "450.00" },
    { employeeId: josue.id, net: "360.00", transport: "25.00", cout: "450.00" },
  ]);
  // Septembre (mois de paie courant) : nets 420,50 + 355,25 = 775,75 ; coût 520,10 + 470,40 = 990,50 ;
  // HS 12,30 ; transport 55,00 ; frais médicaux 7,50.
  await paie(9, 2026, [
    { employeeId: martine.id, net: "450.50", transport: "30.00", cout: "520.10", hs: "12.30", medical: "7.50" },
    { employeeId: josue.id, net: "380.25", transport: "25.00", cout: "470.40" },
  ]);
}, 120_000);

afterAll(async () => { await fermer?.(); });

describe("accueil RH — mêmes chiffres avant et après l'extraction", () => {
  it("cartes du mois de paie et variation sur la paie précédente", async () => {
    const { default: AccueilPage } = await import("@/app/(app)/accueil/page");
    const t = texte(renderToStaticMarkup(await AccueilPage()));
    expect(t).toContain("Masse salariale nette 775,75 $");
    expect(t).toContain("Coût total employeur 990,50 $");
    expect(t).toContain("Heures supp. valorisées 12,30 $");
    expect(t).toContain("Frais de transport 55,00 $");
    expect(t).toContain("Frais médicaux (mois) 7,50 $");
    // Variation : (775,75 − 705) ÷ 705 = +10,04 % ; (990,50 − 900) ÷ 900 = +10,06 %.
    expect(t).toContain("▲ +10,0 % vs mois préc.");
    expect(t).toContain("▲ +10,1 % vs mois préc.");
    // Courbe : un libellé par paie, net arrondi à l'affichage du graphique.
    expect(t).toContain("705$");
    expect(t).toContain("775,75$");
  }, 60_000);
});

describe("indicateursPaieDuMois — fonction partagée", () => {
  it("renvoie les totaux du mois, l'historique et les statuts, sans aucune donnée individuelle", async () => {
    const { indicateursPaieDuMois } = await import("./rh");
    const i = await indicateursPaieDuMois(9, 2026);
    expect(i.runExiste).toBe(true);
    expect(i.statuts).toEqual({ total: 2, nbPaye: 0, nbValide: 0, nbPasValide: 2 });
    expect(i.totaux.masseNette).toBeCloseTo(775.75, 10);
    expect(i.totaux.coutEmployeur).toBeCloseTo(990.5, 10);
    expect(i.historique.map((h) => [h.mois, h.annee])).toEqual([[8, 2026], [9, 2026]]);
    expect(Object.keys(i).sort()).toEqual(["annee", "historique", "mois", "runExiste", "statuts", "totaux", "variationCout", "variationNet"]);
  }, 60_000);

  it("un mois sans paie : totaux à 0, pas de run — la variation reste celle des deux dernières paies", async () => {
    const { indicateursPaieDuMois } = await import("./rh");
    const i = await indicateursPaieDuMois(10, 2026);
    expect(i.runExiste).toBe(false);
    expect(i.totaux).toEqual({ masseNette: 0, coutEmployeur: 0, hsValorisees: 0, transport: 0, fraisMedicaux: 0 });
    expect(i.variationNet).toBeCloseTo(((775.75 - 705) / 705) * 100, 10);
  }, 60_000);

  it("moisDePaie : Config d'abord, mois civil à défaut", async () => {
    const { moisDePaie } = await import("./rh");
    expect(moisDePaie({ moisCourant: 9, anneeCourante: 2026 }, new Date(2027, 0, 5))).toEqual({ mois: 9, annee: 2026 });
    expect(moisDePaie(null, new Date(2027, 0, 5))).toEqual({ mois: 1, annee: 2027 });
  });
});

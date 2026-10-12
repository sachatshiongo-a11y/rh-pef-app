import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import JSZip from "jszip";
import type { PrismaClient, Role } from "@prisma/client";
import { creerBaseTest, seedParametresLegaux } from "@/lib/test/db";
import { tauxDeLigne } from "@/lib/paie-taux";

/**
 * LES BULLETINS D'UN MOIS PASSÉ SORTENT TELS QU'ILS ONT ÉTÉ FIGÉS (demande Direction du 12/10).
 *
 * Les routes `bulletins-pdf`, `bulletins-zip`, `export` (Excel) et `export-pdf` prennent `?mois=&annee=`.
 * Ce test les appelle pour de vrai (base réelle, vraie garde, vraies routes) et prouve :
 *   • un bulletin VALIDÉ ou PAYÉ d'un mois passé reçoit, dans la liasse et dans le ZIP, EXACTEMENT les
 *     propriétés de rendu du bulletin ouvert à l'unité (`genererBulletinPdf`, celui de /paie/bulletin
 *     et de la fiche salarié) : fiche et congés figés à la validation, taux figé (`tauxDeLigne`) ;
 *   • un bulletin non définitif est PROVISOIRE (mois non clôturé) ou absent (ligne hors calcul d'un
 *     mois clôturé), comme partout ailleurs ;
 *   • un mois sans paie, un paramètre illisible : refus texte lisible ; sans paramètre : mois courant ;
 *   • les droits sont ceux des exports du mois courant, et la garde passe avant la lecture du mois.
 *
 * Le rendu PDF est remplacé par un relevé des propriétés passées au document : c'est ce que reçoit
 * le moteur de rendu, donc deux relevés identiques donnent deux PDF identiques.
 */
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
type Compte = { id: string; email: string; nom: string; role: Role; accesStock: boolean; employeeId: string | null };
const A = vi.hoisted(() => ({ user: null as unknown as Compte }));
const RELEVES = vi.hoisted(() => ({ elements: [] as unknown[] }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));
vi.mock("@/lib/auth", () => ({ verifySession: async () => A.user }));
vi.mock("@/lib/storage", () => ({ lireFichier: async () => null, televerserFichier: async (c: string) => `/fichiers/${c}` }));
vi.mock("@/lib/pdf/fonts", () => ({
  registerPdfFonts: () => {},
  renderPdfBuffer: async (el: unknown) => { RELEVES.elements.push(el); return Buffer.from("%PDF-releve"); },
  renderPdfOuRefus: async (construire: () => unknown) => { construire(); return Buffer.from("%PDF-livre"); },
}));

const { GET: bulletinsPdf } = await import("./bulletins-pdf/route");
const { GET: bulletinsZip } = await import("./bulletins-zip/route");
const { GET: livreExcel } = await import("./export/route");
const { GET: livrePdf } = await import("./export-pdf/route");
const { genererBulletinPdf } = await import("@/lib/pdf/bulletin-buffer");

const COURANT = { mois: 10, annee: 2026 };
const PASSE = "mois=9&annee=2026"; // septembre : clôturé (VALIDE)
const BROUILLON = "mois=8&annee=2026"; // août : paie non clôturée

let prisma: PrismaClient;
let fermer: () => Promise<void>;
const ids: Record<string, string> = {};

const compte = (role: Role): Compte => ({ id: `u-${role}`, email: `${role}@test.pef`, nom: role, role, accesStock: false, employeeId: null });
const get = (route: typeof bulletinsPdf, query = "", extra = "") =>
  route(new Request(`http://localhost/x${query || extra ? "?" : ""}${[query, extra].filter(Boolean).join("&")}`));

/** Clés triées : deux objets de mêmes valeurs donnent le même texte, quel que soit l'ordre d'assemblage. */
function stable(v: unknown): string {
  const trier = (x: unknown): unknown =>
    Array.isArray(x) ? x.map(trier)
    : x && typeof x === "object" && !(x instanceof Date) && typeof (x as { toJSON?: unknown }).toJSON !== "function"
      ? Object.fromEntries(Object.entries(x as Record<string, unknown>).filter(([, y]) => y !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, y]) => [k, trier(y)]))
      : x;
  return JSON.stringify(trier(v));
}
type Props = { ligne: { id: string }; employee: { salaireMensuel: unknown }; run: { tauxChangeUtilise: unknown }; provisoire?: boolean; devise: string };
/** Les propriétés de chaque page de bulletin d'un document relevé. */
function pagesDe(el: unknown): Props[] {
  const enfants = (el as { props: { children: unknown } }).props.children;
  return (Array.isArray(enfants) ? enfants : [enfants]).map((e) => retirerRelations((e as { props: Props }).props));
}
/**
 * `ligne.employee`, `ligne.payrollRun` et `run.lignes` sont des RELATIONS que Prisma joint selon la
 * requête (l'unitaire et l'export du mois ne chargent pas les mêmes) : `BulletinPage` ne les lit jamais
 * (il reçoit `employee` et `run` à part). Les comparer testerait la requête, pas le bulletin.
 */
function retirerRelations(p: Props): Props {
  const ligne = { ...(p.ligne as Record<string, unknown>) };
  const run = { ...(p.run as Record<string, unknown>) };
  delete ligne.employee;
  delete ligne.payrollRun;
  delete run.lignes;
  return { ...p, ligne, run } as unknown as Props;
}
async function texte(r: Response) { return Buffer.from(await r.arrayBuffer()).toString("utf8"); }

async function creerLigne(runId: string, employeeId: string, statutPaiement: "PAS_VALIDE" | "VALIDE" | "PAYE", extra: Record<string, unknown> = {}) {
  return prisma.payrollLine.create({
    data: {
      payrollRunId: runId, employeeId, statutPaiement,
      transportUSD: 15, salBrutUSD: 300, cnssSalarieUSD: 15, netImposableUSD: 285,
      iprCalculeUSD: 10, allocFamilialeUSD: 0, salNetUSD: 290, salNetCDF: 667000,
      cnssPatronalUSD: 36, coutEmployeurUSD: 336, coutEmployeurCDF: 772800, ...extra,
    },
  });
}

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  await seedParametresLegaux(prisma, 2026);
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2800, anneeCourante: COURANT.annee, moisCourant: COURANT.mois } });
  const direction = await prisma.user.create({ data: { email: "dir@pef.cd", nom: "Direction", role: "ADMIN" } });

  const emp = async (cle: string, nom: string, salaire: number) => {
    const e = await prisma.employee.create({
      data: {
        matricule: `${cle}-PEF`, nom, sexe: "F", etatCivil: "Célibataire", poste: "Cuisinière", secteur: "Cuisine",
        categorie: "BRIGADE", salaireMensuel: salaire, dateEmbauche: new Date("2025-01-01"), contrat: "CDI",
      },
    });
    ids[cle] = e.id;
  };
  await emp("valide", "Alice Validée", 500); // fiche d'AUJOURD'HUI : 500 $ ; bulletin figé à 300 $
  await emp("paye", "Paul Payé", 400);
  await emp("brouillon", "Berthe Brouillon", 350);
  await emp("courant", "Carole Courante", 320);

  // Septembre : CLÔTURÉ. Le taux de la paie a été réécrit depuis (2800), les lignes gardent le leur (2300).
  const sept = await prisma.payrollRun.create({ data: { mois: 9, annee: 2026, statut: "VALIDE", tauxChangeUtilise: 2800 } });
  const lValide = await creerLigne(sept.id, ids.valide, "VALIDE", { tauxChangeFige: 2300 });
  const lPaye = await creerLigne(sept.id, ids.paye, "PAYE", { tauxChangeFige: 2300 });
  await creerLigne(sept.id, ids.brouillon, "PAS_VALIDE"); // laissée de côté par la clôture : hors calcul
  ids.ligneValide = lValide.id; ids.lignePaye = lPaye.id;
  await prisma.versionBulletin.create({
    data: {
      payrollLineId: lValide.id, numeroVersion: 1, genreParId: direction.id,
      snapshot: { employe: { salaireMensuel: "300", enfants: 0, categorie: "BRIGADE" }, ligne: {}, run: {} },
    },
  });

  // Août : paie NON clôturée, une ligne pas validée => bulletin PROVISOIRE.
  const aout = await prisma.payrollRun.create({ data: { mois: 8, annee: 2026, statut: "BROUILLON", tauxChangeUtilise: 2800 } });
  ids.ligneBrouillon = (await creerLigne(aout.id, ids.brouillon, "PAS_VALIDE")).id;
  await creerLigne(aout.id, ids.valide, "VALIDE", { tauxChangeFige: 2400 });

  // Octobre : mois courant.
  const oct = await prisma.payrollRun.create({ data: { mois: 10, annee: 2026, statut: "BROUILLON", tauxChangeUtilise: 2800 } });
  await creerLigne(oct.id, ids.courant, "PAS_VALIDE");
}, 120_000);

afterAll(async () => { await fermer?.(); });
beforeEach(() => { RELEVES.elements.length = 0; A.user = compte("ADMIN"); });

/** Le relevé du bulletin ouvert à l'unité (route /paie/bulletin, fiche salarié) pour une ligne. */
async function releveUnitaire(ligneId: string, devise: "USD" | "CDF"): Promise<Props> {
  RELEVES.elements.length = 0;
  const pdf = await genererBulletinPdf(ligneId, devise);
  expect(pdf).not.toBeNull();
  return pagesDe(RELEVES.elements[0])[0];
}

describe("mois passé : le même bulletin, à l'unité, dans la liasse et dans le ZIP", () => {
  for (const devise of ["USD", "CDF"] as const) {
    it(`liasse PDF (${devise}) : un bulletin validé ou payé = celui du bulletin unitaire, taux figé compris`, async () => {
      const r = await get(bulletinsPdf, `${PASSE}&devise=${devise}`);
      expect(r.status).toBe(200);
      expect(r.headers.get("Content-Disposition")).toContain(`Bulletins_2026-09_${devise}.pdf`);
      const pages = pagesDe(RELEVES.elements[0]);
      // Ligne hors calcul (pas validée, mois clôturé) : absente. Reste le validé et le payé.
      expect(pages.map((p) => p.ligne.id).sort()).toEqual([ids.ligneValide, ids.lignePaye].sort());

      for (const id of [ids.ligneValide, ids.lignePaye]) {
        const groupe = pages.find((p) => p.ligne.id === id)!;
        const unitaire = await releveUnitaire(id, devise);
        expect(JSON.parse(stable(groupe))).toEqual(JSON.parse(stable(unitaire)));
        expect(groupe.provisoire).toBe(false);
        // Taux du bulletin : celui de sa validation (2 300), pas celui que le recalcul a réécrit sur la paie (2 800).
        expect(tauxDeLigne(groupe.ligne as never, groupe.run as never)).toBe(2300);
      }
    });
  }

  it("la fiche figée à la validation est celle du bulletin (300 $), pas la fiche d'aujourd'hui (500 $)", async () => {
    await get(bulletinsPdf, `${PASSE}&devise=USD`);
    const groupe = pagesDe(RELEVES.elements[0]).find((p) => p.ligne.id === ids.ligneValide)!;
    expect(Number(groupe.employee.salaireMensuel)).toBe(300);
    const payee = pagesDe(RELEVES.elements[0]).find((p) => p.ligne.id === ids.lignePaye)!;
    expect(Number(payee.employee.salaireMensuel)).toBe(400); // jamais d'instantané : la fiche du jour, comme à l'unité
  });

  it("ZIP : un PDF par bulletin, nommé avec le mois, mêmes propriétés que le bulletin unitaire", async () => {
    const r = await get(bulletinsZip, `${PASSE}&devise=CDF`);
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Type")).toBe("application/zip");
    expect(r.headers.get("Content-Disposition")).toContain("Bulletins_2026-09_CDF_separes.zip");
    const zip = await JSZip.loadAsync(Buffer.from(await r.arrayBuffer()));
    const noms = Object.keys(zip.files).sort();
    expect(noms).toHaveLength(2);
    expect(noms.every((n) => n.includes("2026-09") && n.endsWith("_CDF.pdf"))).toBe(true);

    const pages = RELEVES.elements.map((e) => pagesDe(e)[0]);
    expect(pages).toHaveLength(2);
    for (const id of [ids.ligneValide, ids.lignePaye]) {
      const groupe = pages.find((p) => p.ligne.id === id)!;
      expect(JSON.parse(stable(groupe))).toEqual(JSON.parse(stable(await releveUnitaire(id, "CDF"))));
    }
  });

  it("mois non clôturé : une ligne pas validée sort PROVISOIRE (comme à l'unité), une ligne validée non", async () => {
    const r = await get(bulletinsPdf, `${BROUILLON}&devise=USD`);
    expect(r.status).toBe(200);
    const pages = pagesDe(RELEVES.elements[0]);
    expect(pages).toHaveLength(2);
    const prov = pages.find((p) => p.ligne.id === ids.ligneBrouillon)!;
    expect(prov.provisoire).toBe(true);
    expect(JSON.parse(stable(prov))).toEqual(JSON.parse(stable(await releveUnitaire(ids.ligneBrouillon, "USD"))));
    const valide = pages.find((p) => p.ligne.id !== ids.ligneBrouillon)!;
    expect(valide.provisoire).toBe(false);
    expect(tauxDeLigne(valide.ligne as never, valide.run as never)).toBe(2400); // le taux d'août, pas celui de septembre
  });
});

describe("refus lisibles", () => {
  const routes = { "bulletins-pdf": bulletinsPdf, "bulletins-zip": bulletinsZip, export: livreExcel, "export-pdf": livrePdf };

  for (const [nom, route] of Object.entries(routes)) {
    it(`${nom} : mois sans paie calculée → 404 en texte`, async () => {
      const r = await get(route, "mois=6&annee=2026");
      expect(r.status).toBe(404);
      expect(r.headers.get("Content-Type") ?? "").not.toMatch(/pdf|zip|spreadsheet/);
      expect(await texte(r)).toBe("Aucune paie calculée pour ce mois");
    });

    for (const [libelle, q] of [
      ["mois inexistant (13)", "mois=13&annee=2026"],
      ["mois zéro", "mois=0&annee=2026"],
      ["mois non numérique", "mois=abc&annee=2026"],
      ["année absente", "mois=9"],
      ["mois absent", "annee=2026"],
      ["année hors bornes", "mois=9&annee=1999"],
      ["mois vide", "mois=&annee=2026"],
    ] as const) {
      it(`${nom} : ${libelle} → 400, jamais le mois courant en silence`, async () => {
        const r = await get(route, q);
        expect(r.status).toBe(400);
        expect(r.headers.get("Content-Disposition")).toBeNull();
        expect(await texte(r)).toBe("Mois ou année invalide");
      });
    }
  }
});

describe("sans paramètre : le mois courant, comme avant", () => {
  it("liasse PDF et ZIP : octobre 2026", async () => {
    const r = await get(bulletinsPdf, "devise=USD");
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Disposition")).toContain("Bulletins_2026-10_USD.pdf");
    const pages = pagesDe(RELEVES.elements[0]);
    expect(pages).toHaveLength(1);
    expect(pages[0].provisoire).toBe(true);

    const z = await get(bulletinsZip);
    expect(z.status).toBe(200);
    expect(z.headers.get("Content-Disposition")).toContain("Bulletins_2026-10_USD_separes.zip");
  });

  it("livre Excel et PDF : octobre 2026", async () => {
    const x = await get(livreExcel);
    expect(x.status).toBe(200);
    expect(x.headers.get("Content-Disposition")).toContain("Paie_2026-10.xlsx");
    const p = await get(livrePdf);
    expect(p.status).toBe(200);
    expect(p.headers.get("Content-Disposition")).toContain("Livre_paie_2026-10.pdf");
  });

  it("livre Excel d'un mois passé demandé : le bon classeur", async () => {
    const x = await get(livreExcel, PASSE);
    expect(x.status).toBe(200);
    expect(x.headers.get("Content-Disposition")).toContain("Paie_2026-09.xlsx");
  });
});

describe("droits : exactement ceux des exports du mois courant", () => {
  const routes = { "bulletins-pdf": bulletinsPdf, "bulletins-zip": bulletinsZip, export: livreExcel, "export-pdf": livrePdf };
  const AVEC: Role[] = ["ADMIN", "MANAGER", "VIEWER"];
  const SANS: Role[] = ["STOCK", "COMPTA", "EMPLOYE"];

  for (const [nom, route] of Object.entries(routes)) {
    for (const role of AVEC) {
      it(`${role} → ${nom}?mois=… : le fichier`, async () => {
        A.user = compte(role);
        const r = await get(route, PASSE);
        expect(r.status).toBe(200);
      });
    }
    for (const role of SANS) {
      it(`${role} → ${nom}?mois=… : 403, rien n'est rendu`, async () => {
        A.user = compte(role);
        for (const q of [PASSE, "mois=6&annee=2026", "mois=13&annee=2026", "mois=abc"]) {
          RELEVES.elements.length = 0;
          const r = await get(route, q);
          // La garde passe AVANT la lecture du mois : ni 404 ni 400 ne révèlent quoi que ce soit.
          expect(r.status, q).toBe(403);
          expect(r.headers.get("Content-Disposition")).toBeNull();
          expect(await texte(r)).toBe("Accès refusé.");
          expect(RELEVES.elements).toHaveLength(0);
        }
      });
    }
  }
});

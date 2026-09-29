import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import type { LeaveStatus, PrismaClient } from "@prisma/client";
import { creerBaseTest, seedParametresLegaux } from "@/lib/test/db";

/**
 * LE SOLDE FIGÉ À L'APPROBATION (décision Direction 2026-09-29), base relue à chaque fois.
 *
 * Prouvé ici :
 *  - l'approbation, à l'unité, en lot et d'office (Direction), écrit l'instantané — le solde
 *    « après approbation », cette demande comprise — à l'instant de l'approbation ;
 *  - en lot, les soldes se lisent EN UNE FOIS pour tous les salariés ;
 *  - le PDF d'une demande approuvée imprime le figé, même quand le solde courant a bougé depuis ;
 *  - une demande approuvée avant le changement (sans instantané) imprime le solde du jour, daté de
 *    l'ÉDITION — rien n'est reconstitué ; une demande en attente aussi ;
 *  - refuser une demande approuvée efface l'instantané (trace au journal), une nouvelle
 *    approbation en reprend un ; une double approbation ne refige rien ;
 *  - l'empreinte de signature ne voit pas l'instantané : une demande signée ne passe pas
 *    « à resigner » quand son solde est figé.
 *
 * Salariés embauchés le 01/01/2025 : 18 jours acquis tout au long de 2026 (plafond atteint).
 */
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
const A = vi.hoisted(() => ({ user: { id: "seed", role: "ADMIN", nom: "Direction" } }));
// Compteur d'appels de la source unique : prouve la lecture EN LOT (une seule pour tout un lot).
const S = vi.hoisted(() => ({ lots: [] as string[][], unitaires: 0, panne: false }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));
vi.mock("@/lib/auth", () => ({ verifySession: async () => A.user, requireModule: () => {}, requireRole: () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));
vi.mock("@/lib/storage", () => ({ televerserFichier: async () => "/fichiers/x.png", lireFichier: async () => null }));
vi.mock("@/lib/solde-conge-salarie", async (original) => {
  const vrai = await original<typeof import("@/lib/solde-conge-salarie")>();
  return {
    ...vrai,
    chargerSoldesCongeSalaries: (...a: Parameters<typeof vrai.chargerSoldesCongeSalaries>) => {
      S.lots.push([...a[1]]);
      if (S.panne) return Promise.reject(new Error("panne simulée de la lecture des soldes"));
      return vrai.chargerSoldesCongeSalaries(...a);
    },
    chargerSoldeCongeSalarie: (...a: Parameters<typeof vrai.chargerSoldeCongeSalarie>) => {
      S.unitaires++;
      return vrai.chargerSoldeCongeSalarie(...a);
    },
  };
});

const { approuverConge, refuserConge, approuverCongesEnLot, demanderConge } = await import("./actions");
const { genererDemandeCongePdf } = await import("@/lib/pdf/demande-conge-buffer");
const { enregistrerSignature, chargerSignature } = await import("@/lib/signature");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let n = 0;

const APPROBATION = new Date("2026-09-29T10:00:00Z");

async function salarie(): Promise<string> {
  n++;
  const e = await prisma.employee.create({
    data: {
      matricule: `SF${String(n).padStart(2, "0")}-PEF`, nom: `Salarié ${n}`, sexe: "F", etatCivil: "Célibataire",
      poste: "Test", secteur: "Salle", categorie: "BRIGADE", salaireMensuel: 300,
      dateEmbauche: new Date("2025-01-01"), contrat: "CDI",
    },
  });
  return e.id;
}
const demande = (employeeId: string, jourDebut: string, nbJours: number, statut: LeaveStatus = "EN_ATTENTE") =>
  prisma.leaveRequest.create({
    data: { employeeId, type: "Congé annuel", dateDebut: new Date(jourDebut), dateFin: new Date(jourDebut), nbJours, statut },
  }).then((d) => d.id);
const relire = (id: string) => prisma.leaveRequest.findUniqueOrThrow({ where: { id } });
const instantane = async (id: string) => {
  const d = await relire(id);
  return {
    jours: d.soldeFigeJours === null ? null : Number(d.soldeFigeJours),
    acquis: d.soldeFigeAcquis === null ? null : Number(d.soldeFigeAcquis),
    pris: d.soldeFigePris === null ? null : Number(d.soldeFigePris),
    le: d.soldeFigeLe?.toISOString() ?? null,
  };
};
async function textePdf(id: string): Promise<string> {
  const r = await genererDemandeCongePdf(id);
  const { PDFParse } = await import("pdf-parse");
  const { pages } = await new PDFParse({ data: new Uint8Array(r!.buffer) }).getText();
  return pages.map((p) => p.text).join("\n").replace(/\s+/g, " ");
}
const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.append(k, v); return f; };

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2800, anneeCourante: 2026, moisCourant: 9 } });
  await seedParametresLegaux(prisma);
  await prisma.typeConge.create({ data: { nom: "Congé annuel", compteDansSolde: true } });
  const u = await prisma.user.create({ data: { email: "direction.solde.fige@test.pef", nom: "Direction", role: "ADMIN" } });
  A.user.id = u.id;
}, 180_000);

afterAll(async () => { await fermer?.(); });
afterEach(() => { vi.useRealTimers(); });

/** Horloge figée sur `Date` seulement : Postgres, Prisma et les minuteries restent réels. */
const horloge = (d: Date) => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(d); };

describe("approbation à l'unité", () => {
  it("fige le solde APRÈS approbation (cette demande comprise), à l'instant de l'approbation", async () => {
    const emp = await salarie();
    const id = await demande(emp, "2026-10-05", 5);
    horloge(APPROBATION);
    await approuverConge(id);
    expect((await relire(id)).statut).toBe("APPROUVE");
    expect(await instantane(id)).toEqual({ jours: 13, acquis: 18, pris: 5, le: APPROBATION.toISOString() });
  }, 60_000);

  it("une double approbation ne refige rien (le chiffre et sa date restent ceux de la 1re)", async () => {
    const emp = await salarie();
    const id = await demande(emp, "2026-10-05", 5);
    horloge(APPROBATION);
    await approuverConge(id);
    await demande(emp, "2026-11-02", 3, "APPROUVE"); // le solde courant bouge (10 j)
    horloge(new Date("2026-10-01T08:00:00Z"));
    await approuverConge(id);
    expect(await instantane(id)).toEqual({ jours: 13, acquis: 18, pris: 5, le: APPROBATION.toISOString() });
  }, 60_000);
});

describe("approbation en lot", () => {
  it("fige chaque demande, les soldes lus EN UNE FOIS pour tous les salariés", async () => {
    const e1 = await salarie();
    const e2 = await salarie();
    const a = await demande(e1, "2026-10-05", 2);
    const b = await demande(e1, "2026-10-12", 4);
    const c = await demande(e2, "2026-10-05", 1);
    const dejaRefusee = await demande(e2, "2026-10-19", 7, "REFUSE"); // hors lot : pas en attente
    S.lots = []; S.unitaires = 0;
    horloge(APPROBATION);
    const r = await approuverCongesEnLot([a, b, c, dejaRefusee]);
    expect(r).toEqual({ traitees: 3, echecs: [] });
    // UNE lecture de la source pour tout le lot, avec les deux salariés — jamais une par salarié.
    expect(S.lots).toHaveLength(1);
    expect([...S.lots[0]].sort()).toEqual([e1, e2].sort());
    expect(S.unitaires).toBe(0);
    // Deux demandes du même salarié : le solde une fois le lot approuvé, les deux comprises.
    const le = APPROBATION.toISOString();
    expect(await instantane(a)).toEqual({ jours: 12, acquis: 18, pris: 6, le });
    expect(await instantane(b)).toEqual({ jours: 12, acquis: 18, pris: 6, le });
    expect(await instantane(c)).toEqual({ jours: 17, acquis: 18, pris: 1, le });
    expect(await instantane(dejaRefusee)).toEqual({ jours: null, acquis: null, pris: null, le: null });
    expect((await relire(dejaRefusee)).statut).toBe("REFUSE");
  }, 60_000);
});

describe("statut et instantané : tout ou rien", () => {
  it("si le solde ne peut pas être figé, AUCUNE demande du lot n'est approuvée, et l'échec est rendu nommé", async () => {
    const emp = await salarie();
    const a = await demande(emp, "2026-10-05", 2);
    const b = await demande(emp, "2026-10-12", 1);
    S.panne = true;
    try {
      const r = await approuverCongesEnLot([a, b]);
      expect(r.traitees).toBe(0);
      expect(r.echecs).toHaveLength(2);
      expect(r.echecs[0]).toMatch(/^Salarié \d+ : approbation non enregistrée \(panne simulée/);
    } finally {
      S.panne = false;
    }
    expect((await relire(a)).statut).toBe("EN_ATTENTE");
    expect((await relire(b)).statut).toBe("EN_ATTENTE");
  }, 60_000);

  it("à l'unité aussi : pas d'approbation sans instantané", async () => {
    const emp = await salarie();
    const id = await demande(emp, "2026-10-05", 2);
    S.panne = true;
    try {
      // L'erreur est RENDUE, jamais lancée.
      expect((await approuverConge(id)).erreur).toMatch(/^Approbation non enregistrée : panne simulée/);
    } finally {
      S.panne = false;
    }
    expect((await relire(id)).statut).toBe("EN_ATTENTE");
  }, 60_000);
});

describe("approbation d'office (demande saisie par la Direction)", () => {
  it("la demande créée APPROUVÉE porte son solde figé", async () => {
    const emp = await salarie();
    horloge(APPROBATION);
    await demanderConge(fd({ employeeId: emp, type: "Congé annuel", dateDebut: "2026-10-05", dateFin: "2026-10-06", nbJours: "2" }));
    const d = await prisma.leaveRequest.findFirstOrThrow({ where: { employeeId: emp } });
    expect(d.statut).toBe("APPROUVE");
    expect(await instantane(d.id)).toEqual({ jours: 16, acquis: 18, pris: 2, le: APPROBATION.toISOString() });
  }, 60_000);
});

describe("le PDF de la demande", () => {
  it("approuvée : imprime le solde FIGÉ et sa date d'approbation, même si le solde courant a bougé", async () => {
    const emp = await salarie();
    const id = await demande(emp, "2026-10-05", 5);
    horloge(APPROBATION);
    await approuverConge(id);
    // Depuis : une autre demande approuvée, le solde courant passe de 13 à 10.
    const autre = await demande(emp, "2026-11-02", 3);
    horloge(new Date("2026-10-15T09:00:00Z"));
    await approuverConge(autre);
    const texte = await textePdf(id);
    expect(texte).toContain("Solde de congé annuel après approbation");
    expect(texte).toContain("au 29/09/2026, date d'approbation");
    expect(texte).toContain("13 jours");
    expect(texte).not.toContain("10 jours");
    // La demande approuvée ensuite imprime SON propre figé (10 j au 15/10).
    const texteAutre = await textePdf(autre);
    expect(texteAutre).toContain("10 jours");
    expect(texteAutre).toContain("au 15/10/2026, date d'approbation");
  }, 120_000);

  it("approuvée AVANT le changement (sans instantané) : solde du jour, daté de l'ÉDITION — rien de reconstitué", async () => {
    const emp = await salarie();
    const ancienne = await demande(emp, "2026-08-03", 4, "APPROUVE");
    await demande(emp, "2026-11-02", 3, "APPROUVE");
    horloge(new Date("2026-10-15T09:00:00Z"));
    const texte = await textePdf(ancienne);
    expect(texte).toContain("Solde de congé annuel disponible");
    expect(texte).toContain("au 15/10/2026, date d'édition");
    expect(texte).toContain("11 jours"); // 18 − 4 − 3, le solde du jour
    expect(texte).not.toContain("date d'approbation");
    // Et l'ouverture du PDF n'a rien écrit en base.
    expect(await instantane(ancienne)).toEqual({ jours: null, acquis: null, pris: null, le: null });
  }, 120_000);

  it("en attente : solde du jour, daté de l'édition", async () => {
    const emp = await salarie();
    const id = await demande(emp, "2026-12-07", 2);
    horloge(new Date("2026-10-15T09:00:00Z"));
    const texte = await textePdf(id);
    expect(texte).toContain("au 15/10/2026, date d'édition");
    expect(texte).toContain("18 jours");
  }, 120_000);
});

describe("annulation d'une approbation", () => {
  it("refuser une demande approuvée EFFACE son instantané (trace au journal) ; la réapprouver en reprend un neuf", async () => {
    const emp = await salarie();
    const id = await demande(emp, "2026-10-05", 5);
    horloge(APPROBATION);
    await approuverConge(id);
    expect((await instantane(id)).jours).toBe(13);

    horloge(new Date("2026-10-01T08:00:00Z"));
    await refuserConge(id);
    expect((await relire(id)).statut).toBe("REFUSE");
    expect(await instantane(id)).toEqual({ jours: null, acquis: null, pris: null, le: null });
    const trace = await prisma.journalAudit.findFirst({ where: { entite: "LeaveRequest", entiteId: id, champ: "soldeFige" } });
    expect(trace?.ancienneValeur).toBe(`13 j au ${APPROBATION.toISOString()}`);
    expect(trace?.nouvelleValeur).toBeNull();
    // Refusée : le PDF lit le solde du jour (18 : la demande ne compte plus), daté de l'édition.
    expect(await textePdf(id)).toContain("au 01/10/2026, date d'édition");

    const reapprobation = new Date("2026-10-02T08:00:00Z");
    horloge(reapprobation);
    await approuverConge(id);
    expect(await instantane(id)).toEqual({ jours: 13, acquis: 18, pris: 5, le: reapprobation.toISOString() });
  }, 120_000);
});

describe("empreinte de signature", () => {
  it("une demande signée ne passe pas « à resigner » quand son solde est figé", async () => {
    const emp = await salarie();
    const id = await demande(emp, "2026-08-03", 4, "APPROUVE"); // approuvée avant : sans instantané
    await enregistrerSignature(prisma, {
      cible: "DEMANDE_CONGE", cibleId: id, employeeId: emp,
      traceUrl: "/fichiers/signatures/demande_conge/test.png", mode: "ESPACE_SALARIE", presenteParId: null,
    });
    await prisma.leaveRequest.update({
      where: { id },
      data: { soldeFigeJours: 14, soldeFigeAcquis: 18, soldeFigePris: 4, soldeFigeLe: APPROBATION },
    });
    expect((await chargerSignature(prisma, "DEMANDE_CONGE", id))?.obsolete).toBe(false);
    // Témoin : la même lecture VOIT bien une modification signée (sinon ce test ne prouverait rien).
    await prisma.leaveRequest.update({ where: { id }, data: { nbJours: 5 } });
    expect((await chargerSignature(prisma, "DEMANDE_CONGE", id))?.obsolete).toBe(true);
  }, 60_000);
});

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient, Role } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";
import { canonique } from "@/lib/signature-document";

// DÉCISION DE LA DIRECTION DU 2026-10-12 — deux gestes sur un bulletin PAYÉ, preuve sur une base éphémère avec les VRAIES
// actions serveur (seule la session est simulée) :
//  1. ANNULER UN PAIEMENT (Payé → Validé) se ferme côté serveur hors du mois en cours, et pour une paie clôturée ;
//     un lot qui glisse un paiement d'un autre mois est refusé EN ENTIER, rien n'est écrit.
//  2. « CORRIGER LE PAIEMENT » : la date de versement et le moyen, de n'importe quel mois, par la Direction SEULE, avec un
//     motif obligatoire. L'état, les montants et le taux figé ne bougent pas ; la correction est tracée ; la signature
//     n'est pas touchée (la date et le moyen ne sont pas dans l'empreinte) ; un mois d'Exploitation clôturé n'est pas
//     modifié en silence.

const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
const A = vi.hoisted(() => ({ user: { id: "", email: "", nom: "", role: "ADMIN" as string, accesStock: false, employeeId: null as string | null } }));

vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));
vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), verifySession: async () => A.user }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw Object.assign(new Error(`REDIRECT ${url}`), { digest: `NEXT_REDIRECT;${url}`, url }); },
  notFound: () => { throw Object.assign(new Error("NOT_FOUND"), { digest: "NEXT_NOT_FOUND" }); },
}));
vi.mock("@/lib/push", () => ({ envoyerPush: async () => {} }));

const PAIE = await import("./actions");
const CORRECTION = await import("./correction-paiement-actions");
const SIGNATURE = await import("@/lib/signature");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
type Compte = "DIR" | "MGR" | "VIEW" | "STK" | "COMPTA";
const COMPTES: Record<Compte, { role: Role; nom: string }> = {
  DIR: { role: "ADMIN", nom: "Direction" },
  MGR: { role: "MANAGER", nom: "Responsable RH" },
  VIEW: { role: "VIEWER", nom: "Consultation" },
  STK: { role: "STOCK", nom: "Magasinier" },
  COMPTA: { role: "COMPTA", nom: "Comptable" },
};
const ids = {} as Record<Compte, string>;
const L = {} as { sept: string; sept2: string; oct: string; oct2: string; octValide: string; octCloture: string };
let runOct = "";

const en = (c: Compte) => { A.user = { id: ids[c], email: `${c}@pef.test`, nom: COMPTES[c].nom, role: COMPTES[c].role, accesStock: false, employeeId: null }; };
const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const corriger = (id: string, o: Record<string, string>) => CORRECTION.corrigerPaiementBulletin(id, fd({ __retour_erreur: "1", ...o }));

/** Le refus d'une action : valeur `{ erreur }`, `?erreur=` de redirection (avec sa page) ou erreur levée ; null si elle a réussi. */
async function tenter(fn: () => Promise<unknown>): Promise<{ page: string | null; message: string } | null> {
  try {
    const r = await fn();
    if (typeof r === "object" && r !== null && "erreur" in r) return { page: null, message: String((r as { erreur: unknown }).erreur) };
    return null;
  } catch (e) {
    const url = (e as { url?: string }).url;
    if (url !== undefined) { const m = /^([^?]*)\?erreur=(.*)$/.exec(url); return m ? { page: m[1], message: decodeURIComponent(m[2]) } : { page: url, message: "" }; }
    return { page: null, message: e instanceof Error ? e.message : String(e) };
  }
}
const lire = (id: string) => prisma.payrollLine.findUniqueOrThrow({ where: { id } });
const jour = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;
const traces = (id: string) => prisma.transitionPaie.findMany({ where: { payrollLineId: id }, orderBy: { date: "asc" } });
const audits = (id: string) => prisma.journalAudit.findMany({ where: { entite: "PayrollLine", entiteId: id, champ: "correctionPaiement" } });

let seq = 0;
async function employe(nom: string) {
  return (await prisma.employee.create({
    data: { matricule: `C-${++seq}`, nom, sexe: "F", etatCivil: "Célibataire", poste: "Commis", secteur: "Cuisine", categorie: "BRIGADE", salaireMensuel: 300, dateEmbauche: new Date("2025-01-01"), contrat: "CDI" },
  })).id;
}
const ligne = (payrollRunId: string, employeeId: string, statutPaiement: "PAS_VALIDE" | "VALIDE" | "PAYE", extra: Record<string, unknown> = {}) => prisma.payrollLine.create({
  data: {
    payrollRunId, employeeId, statutPaiement, salBrutUSD: 300, cnssSalarieUSD: 15, netImposableUSD: 285, iprCalculeUSD: 10, allocFamilialeUSD: 0,
    salNetUSD: 270, salNetCDF: 756000, cnssPatronalUSD: 30, coutEmployeurUSD: 330, coutEmployeurCDF: 924000, ...extra,
  },
});

beforeAll(async () => {
  // L'instant fixé : « aujourd'hui » = 12/10/2026 (Kinshasa). Seule l'horloge (Date) est simulée.
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-12T10:00:00.000Z") });
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  for (const c of Object.keys(COMPTES) as Compte[]) ids[c] = (await prisma.user.create({ data: { email: `${c.toLowerCase()}@pef.test`, nom: COMPTES[c].nom, role: COMPTES[c].role } })).id;
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2800, anneeCourante: 2026, moisCourant: 10 } });
  const sept = await prisma.payrollRun.create({ data: { mois: 9, annee: 2026, tauxChangeUtilise: 2750, statut: "VALIDE" } }); // paie clôturée
  const oct = await prisma.payrollRun.create({ data: { mois: 10, annee: 2026, tauxChangeUtilise: 2800 } });
  runOct = oct.id;
  const paye = (mode: "ESPECES" | "VIREMENT", date: string, taux: number) => ({ datePaiement: new Date(date), modePaiement: mode, payeParId: ids.MGR, tauxChangeFige: taux, transportUSD: 20 });
  L.sept = (await ligne(sept.id, await employe("Salarie Septembre"), "PAYE", paye("ESPECES", "2026-09-30", 2750))).id;
  L.sept2 = (await ligne(sept.id, await employe("Salarie Septembre Deux"), "PAYE", paye("ESPECES", "2026-09-29", 2750))).id;
  L.oct = (await ligne(oct.id, await employe("Salarie Octobre"), "PAYE", paye("VIREMENT", "2026-10-03", 2800))).id;
  L.oct2 = (await ligne(oct.id, await employe("Salarie Octobre Deux"), "PAYE", paye("VIREMENT", "2026-10-04", 2800))).id;
  L.octCloture = (await ligne(oct.id, await employe("Salarie Octobre Trois"), "PAYE", paye("VIREMENT", "2026-10-05", 2800))).id;
  L.octValide = (await ligne(oct.id, await employe("Salarie Octobre Valide"), "VALIDE", { tauxChangeFige: 2800 })).id;
}, 180_000);
afterAll(async () => { vi.useRealTimers(); await fermer?.(); });

describe("annuler un paiement : fermé côté serveur hors du mois en cours et pour une paie clôturée", () => {
  it("un paiement d'un mois clôturé / quitté ne s'annule pas (unitaire) : message lisible, rien d'écrit", async () => {
    en("DIR");
    const refus = await tenter(() => PAIE.changerStatutPaie(L.sept, fd({ versStatut: "VALIDE", retour: "/a-valider" })));
    expect(refus?.page).toBe("/a-valider");
    expect(refus?.message).toMatch(/Salarie Septembre : ce bulletin appartient à la paie de septembre 2026, qui n'est plus le mois en cours/);
    expect(refus?.message).toContain("Corriger le paiement");
    const l = await lire(L.sept);
    expect(l.statutPaiement).toBe("PAYE");
    expect(jour(l.datePaiement)).toBe("2026-09-30");
    expect(Number(l.tauxChangeFige)).toBe(2750);
    expect(await traces(L.sept)).toHaveLength(0);
  });

  it("un lot qui mêle le mois en cours et un mois quitté est refusé EN ENTIER (rien n'est écrit)", async () => {
    en("DIR");
    const refus = await tenter(() => PAIE.changerStatutEnLot([L.oct2, L.sept], "VALIDE", null, {}));
    expect(refus?.message).toMatch(/septembre 2026/);
    for (const id of [L.oct2, L.sept]) {
      expect((await lire(id)).statutPaiement).toBe("PAYE");
      expect(await traces(id)).toHaveLength(0);
    }
  });

  it("le mois en cours dont la paie est CLÔTURÉE (statut Validé de la paie) : refusé aussi, avec le mot « clôturée »", async () => {
    en("DIR");
    await prisma.payrollRun.update({ where: { id: runOct }, data: { statut: "VALIDE" } });
    try {
      const refus = await tenter(() => PAIE.changerStatutPaie(L.octCloture, fd({ versStatut: "VALIDE", retour: "/a-valider" })));
      expect(refus?.message).toMatch(/octobre 2026, qui est clôturée/);
      expect((await lire(L.octCloture)).statutPaiement).toBe("PAYE");
      expect(await traces(L.octCloture)).toHaveLength(0);
    } finally {
      await prisma.payrollRun.update({ where: { id: runOct }, data: { statut: "BROUILLON" } });
    }
  });

  it("le mois en cours, paie non clôturée : l'annulation marche toujours (Direction), le taux figé est gardé", async () => {
    en("DIR");
    expect(await tenter(() => PAIE.changerStatutPaie(L.oct2, fd({ versStatut: "VALIDE", retour: "/a-valider" })))).toBeNull();
    const l = await lire(L.oct2);
    expect(l.statutPaiement).toBe("VALIDE");
    expect(Number(l.tauxChangeFige)).toBe(2800);
    await prisma.payrollLine.update({ where: { id: L.oct2 }, data: { statutPaiement: "PAYE" } }); // pour la suite
  });
});

describe("corriger le paiement : la Direction seule, motif obligatoire", () => {
  it.each(["MGR", "VIEW", "STK", "COMPTA"] as Compte[])("%s : refusé par le serveur, rien n'est écrit", async (c) => {
    en(c);
    const refus = await tenter(() => corriger(L.sept, { datePaiement: "2026-10-01", modePaiement: "VIREMENT", motif: "Tentative" }));
    expect(refus, c).not.toBeNull();
    const l = await lire(L.sept);
    expect(jour(l.datePaiement)).toBe("2026-09-30");
    expect(l.modePaiement).toBe("ESPECES");
    expect(await traces(L.sept)).toHaveLength(0);
    expect(await audits(L.sept)).toHaveLength(0);
  });

  it("motif vide ou d'espaces : refus, rien n'est écrit", async () => {
    en("DIR");
    for (const motif of ["", "   ", "\n"]) {
      const refus = await tenter(() => corriger(L.sept, { datePaiement: "2026-10-01", modePaiement: "VIREMENT", motif }));
      expect(refus?.message, JSON.stringify(motif)).toBe("Le motif de la correction est obligatoire.");
    }
    expect(await tenter(() => CORRECTION.corrigerPaiementBulletin(L.sept, fd({ __retour_erreur: "1", datePaiement: "2026-10-01", modePaiement: "VIREMENT" })))).not.toBeNull(); // motif absent
    expect(jour((await lire(L.sept)).datePaiement)).toBe("2026-09-30");
    expect(await traces(L.sept)).toHaveLength(0);
  });

  it("les mêmes contrôles de date que « Marquer payé » : future, illisible, vide, avant le 1er du mois de la paie ; moyen invalide", async () => {
    en("DIR");
    const essais: [Record<string, string>, RegExp][] = [
      [{ datePaiement: "2026-10-13", modePaiement: "VIREMENT", motif: "x" }, /futur/],
      [{ datePaiement: "2026-02-30", modePaiement: "VIREMENT", motif: "x" }, /invalide/],
      [{ datePaiement: "", modePaiement: "VIREMENT", motif: "x" }, /obligatoire/],
      [{ datePaiement: "2026-08-31", modePaiement: "VIREMENT", motif: "x" }, /antérieure au 1er jour du mois de la paie \(septembre 2026\)/],
      [{ datePaiement: "2026-10-01", modePaiement: "BITCOIN", motif: "x" }, /moyen de paiement/],
      [{ datePaiement: "2026-09-30", modePaiement: "ESPECES", motif: "x" }, /Rien à corriger/],
    ];
    for (const [o, re] of essais) expect((await tenter(() => corriger(L.sept, o)))?.message, JSON.stringify(o)).toMatch(re);
    expect(await traces(L.sept)).toHaveLength(0);
  });

  it("un bulletin pas encore payé ne se corrige pas ici", async () => {
    en("DIR");
    const refus = await tenter(() => corriger(L.octValide, { datePaiement: "2026-10-01", modePaiement: "VIREMENT", motif: "x" }));
    expect(refus?.message).toMatch(/Seul un bulletin payé/);
    const l = await lire(L.octValide);
    expect(l.statutPaiement).toBe("VALIDE");
    expect(l.datePaiement).toBeNull();
  });

  it("date ET moyen d'un mois CLÔTURÉ : corrigés ; l'état, les montants, le taux figé, le payeur ne bougent pas ; la correction est tracée", async () => {
    en("DIR");
    const avant = await lire(L.sept);
    expect(await tenter(() => corriger(L.sept, { datePaiement: "2026-09-28", modePaiement: "MOBILE_MONEY", motif: "Versé par Mobile Money le 28" }))).toBeNull();
    const apres = await lire(L.sept);
    expect(jour(apres.datePaiement)).toBe("2026-09-28");
    expect(apres.modePaiement).toBe("MOBILE_MONEY");
    // Inchangés : tout le reste de la ligne.
    const { datePaiement: _d, modePaiement: _m, ...resteAvant } = avant;
    const { datePaiement: _d2, modePaiement: _m2, ...resteApres } = apres;
    expect(resteApres).toEqual(resteAvant);
    expect(apres.statutPaiement).toBe("PAYE");
    expect(Number(apres.tauxChangeFige)).toBe(2750);
    expect(apres.payeParId).toBe(ids.MGR);
    // Trace de la ligne : Payé → Payé, auteur, motif, ancienne → nouvelle valeur.
    const t = await traces(L.sept);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ deStatut: "PAYE", versStatut: "PAYE", userId: ids.DIR, modePaiement: "MOBILE_MONEY" });
    expect(t[0].commentaire).toBe("Correction du paiement : date 30/09/2026 → 28/09/2026 ; moyen Espèces → Mobile Money. Motif : Versé par Mobile Money le 28");
    // Journal d'audit : avant, après, motif, auteur, date.
    const a = await audits(L.sept);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ userId: ids.DIR, ancienneValeur: "30/09/2026 · Espèces", nouvelleValeur: "28/09/2026 · Mobile Money — motif : Versé par Mobile Money le 28" });
  });

  it("le moyen seul, ou la date seule : seul ce qui change est écrit", async () => {
    en("DIR");
    expect(await tenter(() => corriger(L.oct, { datePaiement: "2026-10-03", modePaiement: "CHEQUE", motif: "C'était un chèque" }))).toBeNull();
    let l = await lire(L.oct);
    expect([jour(l.datePaiement), l.modePaiement]).toEqual(["2026-10-03", "CHEQUE"]);
    expect(await tenter(() => corriger(L.oct, { datePaiement: "2026-10-02", modePaiement: "CHEQUE", motif: "Date du chèque" }))).toBeNull();
    l = await lire(L.oct);
    expect([jour(l.datePaiement), l.modePaiement]).toEqual(["2026-10-02", "CHEQUE"]);
    expect((await traces(L.oct)).map((t) => t.commentaire)).toEqual([
      "Correction du paiement : moyen Virement → Chèque. Motif : C'était un chèque",
      "Correction du paiement : date 03/10/2026 → 02/10/2026. Motif : Date du chèque",
    ]);
  });

  it("la signature n'est pas touchée : l'empreinte du bulletin est la même avant et après (ni la date ni le moyen n'y sont)", async () => {
    en("DIR");
    const avant = canonique((await SIGNATURE.instantaneDe(prisma, "BULLETIN", L.sept2))!);
    expect(await tenter(() => corriger(L.sept2, { datePaiement: "2026-09-27", modePaiement: "VIREMENT", motif: "Virement du 27" }))).toBeNull();
    expect(canonique((await SIGNATURE.instantaneDe(prisma, "BULLETIN", L.sept2))!)).toBe(avant);
  });
});

describe("Exploitation : un mois clôturé ne bouge pas en silence", () => {
  it("déplacer le paiement d'un mois d'Exploitation à un autre alors que l'un est clôturé : refusé, rien n'est écrit", async () => {
    en("DIR");
    await prisma.clotureExploitation.create({ data: { annee: 2026, mois: 9, creeParNom: "Direction" } });
    const avant = await lire(L.sept);
    const refus = await tenter(() => corriger(L.sept, { datePaiement: "2026-10-02", modePaiement: avant.modePaiement!, motif: "Versé en octobre" }));
    expect(refus?.message).toMatch(/Le mois de septembre 2026 est clôturé dans l'Exploitation/);
    expect(jour((await lire(L.sept)).datePaiement)).toBe("2026-09-28");
    expect(await traces(L.sept)).toHaveLength(1); // la correction précédente seulement
  });

  it("dans le MÊME mois (clos ou non), ou le moyen seul : accepté — la paie versée du mois ne bouge pas", async () => {
    en("DIR");
    expect(await tenter(() => corriger(L.sept, { datePaiement: "2026-09-26", modePaiement: "MOBILE_MONEY", motif: "Date exacte du reçu" }))).toBeNull();
    expect(jour((await lire(L.sept)).datePaiement)).toBe("2026-09-26");
    expect(await tenter(() => corriger(L.sept, { datePaiement: "2026-09-26", modePaiement: "AUTRE", motif: "Autre moyen" }))).toBeNull();
    expect((await lire(L.sept)).modePaiement).toBe("AUTRE");
  });

  it("un mois d'Exploitation NON clôturé : le déplacement d'un mois à l'autre est accepté", async () => {
    en("DIR");
    expect(await tenter(() => corriger(L.oct, { datePaiement: "2026-10-09", modePaiement: "CHEQUE", motif: "Chèque encaissé le 9" }))).toBeNull();
    expect(jour((await lire(L.oct)).datePaiement)).toBe("2026-10-09");
  });
});

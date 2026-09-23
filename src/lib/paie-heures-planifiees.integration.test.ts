import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest, seedParametresLegaux } from "@/lib/test/db";

// BOUT EN BOUT — septembre 2026 reconstitué pour trois salariés RÉELS (données de production lues
// le 2026-09-23, lecture seule), sur le VRAI moteur (calculerLignesPaie → calculerReferenceMois →
// calculerPaieBrigade, brut reconstitué depuis le net) et le VRAI chemin de persistance
// (rafraichirPaieDuMois). Critère d'acceptation de la spec §8 : 400,00 / 200,00 / 200,00 de base
// nette.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));
const { calculerLignesPaie } = await import("./paie-batch");
const { rafraichirPaieDuMois } = await import("./paie-refresh");
const { calculerBulletinLive } = await import("./bulletin-live");
const { ApercuBulletinCard } = await import("@/app/(app)/employes/[id]/apercu-bulletin");
const { renderToStaticMarkup } = await import("react-dom/server");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
const ids = { martine: "", syntyche: "", marie: "", semaineVide: "", cheval: "", ferieHors: "", sansSolde: "", finCdd: "", cddEchu: "" };
let userId = "";

const d = (n: number, mois = 9) => new Date(Date.UTC(2026, mois - 1, n));
const SAISI = new Date("2026-10-01T08:00:00Z"); // saisies faites APRÈS les jours : aucun « saisi d'avance »
const PLANIFIE = new Date("2026-08-25T08:00:00Z"); // planning posé AVANT les heures
const septembre = Array.from({ length: 30 }, (_, i) => d(i + 1));
const lunSam = (x: Date) => x.getUTCDay() !== 0;

async function salarie(matricule: string, nom: string, salaireMensuel: number, heuresHebdomadaires: number, heuresParJour: number, enfants: number) {
  return (await prisma.employee.create({ data: {
    matricule, nom, sexe: "F", etatCivil: "Célibataire", poste: "Brigade", secteur: "Cuisine", categorie: "BRIGADE",
    salaireMensuel, heuresHebdomadaires, heuresParJour, enfants, transportJourCDF: 0,
    dateEmbauche: new Date("2025-01-06T00:00:00Z"), contrat: "CDD",
  } })).id;
}
async function planifier(employeeId: string, shiftId: string, jours: Date[]) {
  await prisma.planningCreneau.createMany({ data: jours.map((date) => ({ employeeId, date, shiftId, createdAt: PLANIFIE, updatedAt: PLANIFIE })) });
}
async function pointer(employeeId: string, jours: Date[], code: "P" | "C" | "S", heures: number) {
  await prisma.attendance.createMany({ data: jours.map((date) => ({ employeeId, date, code, createdAt: SAISI, updatedAt: SAISI })) });
  if (heures > 0) await prisma.overtimeEntry.createMany({ data: jours.map((date) => ({ employeeId, date, heuresTravaillees: heures, createdAt: SAISI, updatedAt: SAISI })) });
}

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  await seedParametresLegaux(prisma, 2026, { referencePlanningDepuis: 202609 });
  await prisma.parametreLegal.create({ data: { exerciceId: (await prisma.exerciceFiscal.findFirstOrThrow()).id, cle: "salaires_saisis_en_net", valeur: 1, unite: "choix", libelle: "Salaires saisis en net" } });
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2300, anneeCourante: 2026, moisCourant: 9 } });
  userId = (await prisma.user.create({ data: { email: "paie@pef.cd", nom: "Direction", role: "ADMIN" } })).id;

  const journee = await prisma.shift.create({ data: { nom: "Journée", heureDebut: "08:00", heureFin: "17:00" } }); // 9 h
  const service = await prisma.shift.create({ data: { nom: "Service", heureDebut: "10:00", heureFin: "16:00" } }); // 6 h
  const cuisine = await prisma.shift.create({ data: { nom: "Matin/cuisine", heureDebut: "08:30", heureFin: "16:30" } }); // 8 h

  // Martine Mutombo : 400 $ net, contrat 54 h, planning lun–ven + samedis 12 et 26 → 216 h, toutes faites.
  ids.martine = await salarie("MM01-PEF", "Martine Mutombo", 400, 54, 9, 2);
  const joursMartine = septembre.filter((x) => (x.getUTCDay() >= 1 && x.getUTCDay() <= 5) || x.getUTCDate() === 12 || x.getUTCDate() === 26);
  await planifier(ids.martine, journee.id, joursMartine);
  await pointer(ids.martine, joursMartine, "P", 9);

  // Syntyche Kanku : 200 $, 36 h, 6 h du lundi au samedi jusqu'au 19 ; congé du 21 au 30 SANS créneau.
  ids.syntyche = await salarie("SK01-PEF", "Syntyche Kanku", 200, 36, 6, 0);
  const travailSyntyche = septembre.filter((x) => lunSam(x) && x.getUTCDate() <= 19);
  await planifier(ids.syntyche, service.id, travailSyntyche);
  await pointer(ids.syntyche, travailSyntyche, "P", 6);
  await pointer(ids.syntyche, septembre.filter((x) => lunSam(x) && x.getUTCDate() >= 21), "C", 0);

  // Marie Samwel : 200 $, 48 h, 8 h du lundi au samedi tout le mois ; congé du 1er au 14 posé SUR les créneaux.
  ids.marie = await salarie("MS01-PEF", "Marie Samwel", 200, 48, 8, 0);
  await planifier(ids.marie, cuisine.id, septembre.filter(lunSam));
  await pointer(ids.marie, septembre.filter((x) => lunSam(x) && x.getUTCDate() <= 14), "C", 0);
  await pointer(ids.marie, septembre.filter((x) => lunSam(x) && x.getUTCDate() >= 15), "P", 8);

  // Planning incomplet : semaine du 21 au 27 sans aucun créneau → repli visible sur le contrat.
  ids.semaineVide = await salarie("SV01-PEF", "Semaine Vide", 208, 48, 8, 0);
  await planifier(ids.semaineVide, cuisine.id, septembre.filter((x) => lunSam(x) && (x.getUTCDate() < 21 || x.getUTCDate() > 27)));
  await pointer(ids.semaineVide, septembre.filter(lunSam), "P", 8);

  // ── Champs de `JoursEmploye` qui doivent arriver EN ENTIER jusqu'à `calculerReferenceMois` ──
  const long = await prisma.shift.create({ data: { nom: "Longue", heureDebut: "07:00", heureFin: "19:00" } }); // 12 h
  const repos = await prisma.shift.create({ data: { nom: "Repos", systeme: true } });
  const mardiJeudiSamedi = (x: Date) => [2, 4, 6].includes(x.getUTCDay());

  // Semaine à cheval (`joursHorsMois`) : 36 h/sem, 12 h mardi-jeudi-samedi, congé sans solde du lundi
  // 28 au mercredi 30/09 sans créneau ; octobre DÉJÀ planifié (jeudi 1er, samedi 3). Plafond de la
  // semaine entière : 36 − 24 = 12 h retenues, pas 36.
  ids.cheval = await salarie("CH01-PEF", "Semaine À Cheval", 200, 36, 12, 0);
  const travailCheval = septembre.filter((x) => mardiJeudiSamedi(x) && x.getUTCDate() <= 26);
  await planifier(ids.cheval, long.id, [...travailCheval, d(1, 10), d(3, 10)]);
  await pointer(ids.cheval, travailCheval, "P", 12);
  await pointer(ids.cheval, [d(28), d(29), d(30)], "S", 0);

  // Férié HORS du mois (`joursFeries` de la plage élargie) : lundi 31/08 férié, sur un créneau ; congé
  // sans solde du 1er au 5/09 sans créneau. Le férié n'entre pas dans les heures planifiées de la
  // semaine : plafond 36 h, pas 24.
  await prisma.jourFerie.create({ data: { date: d(31, 8), designation: "Férié fictif (test)", annee: 2026 } });
  ids.ferieHors = await salarie("FH01-PEF", "Férié Hors Mois", 200, 36, 12, 0);
  const travailFerie = septembre.filter((x) => mardiJeudiSamedi(x) && x.getUTCDate() >= 7);
  await planifier(ids.ferieHors, long.id, [d(31, 8), ...travailFerie]);
  await pointer(ids.ferieHors, travailFerie, "P", 12);
  await pointer(ids.ferieHors, septembre.filter((x) => lunSam(x) && x.getUTCDate() <= 5), "S", 0);

  // Congé sans solde APPROUVÉ du 14 au 19/09 (`joursCongeSansSolde`), mercredi 16 recodé C à la main.
  await prisma.typeConge.create({ data: { nom: "Congé sans solde", tauxPct: 0, joursPayes: 0 } });
  ids.sansSolde = await salarie("SS01-PEF", "Sans Solde", 208, 48, 8, 0);
  const congeSS = (x: Date) => x.getUTCDate() >= 14 && x.getUTCDate() <= 20;
  await planifier(ids.sansSolde, cuisine.id, septembre.filter((x) => lunSam(x) && !congeSS(x)));
  await pointer(ids.sansSolde, septembre.filter((x) => lunSam(x) && !congeSS(x)), "P", 8);
  await pointer(ids.sansSolde, [d(14), d(15), d(17), d(18), d(19)], "S", 0);
  await pointer(ids.sansSolde, [d(16)], "C", 0);
  await prisma.leaveRequest.create({ data: { employeeId: ids.sansSolde, type: "Congé sans solde", dateDebut: d(14), dateFin: d(19), nbJours: 6, statut: "APPROUVE" } });

  // Fin de CDD le 18/09 (`dateFinContrat`) : planning jusqu'au 18, puis des créneaux Repos (système).
  ids.finCdd = await salarie("FC01-PEF", "Fin De CDD", 208, 48, 8, 0);
  await prisma.contrat.create({ data: { employeeId: ids.finCdd, type: "CDD", dateDebut: d(1, 3), dateFin: d(18), salaireMensuel: 208, poste: "Brigade" } });
  await planifier(ids.finCdd, cuisine.id, septembre.filter((x) => lunSam(x) && x.getUTCDate() <= 18));
  await planifier(ids.finCdd, repos.id, septembre.filter((x) => lunSam(x) && x.getUTCDate() > 18));
  await pointer(ids.finCdd, septembre.filter((x) => lunSam(x) && x.getUTCDate() <= 18), "P", 8);

  // CDD échu le 01/09 mais poursuivi tout le mois (`cddEchuLe`) : payé sur le planning, signalé.
  ids.cddEchu = await salarie("CE01-PEF", "CDD Échu", 208, 48, 8, 0);
  await prisma.contrat.create({ data: { employeeId: ids.cddEchu, type: "CDD", dateDebut: d(1, 3), dateFin: d(1), salaireMensuel: 208, poste: "Brigade" } });
  await planifier(ids.cddEchu, cuisine.id, septembre.filter(lunSam));
  await pointer(ids.cddEchu, septembre.filter(lunSam), "P", 8);
}, 180_000);
afterAll(async () => { await fermer?.(); });

/** Base nette = salaire net − transport − allocation familiale (le salaire du contrat). */
const baseNette = (l: { salNetUSD: number; transportUSD: number; allocFamilialeUSD: number }) =>
  (l.salNetUSD - l.transportUSD - l.allocFamilialeUSD).toFixed(2);

describe("paie de septembre 2026 sur heures planifiées — bout en bout", () => {
  it("Martine 400,00 ; Syntyche 200,00 ; Marie 200,00 de base nette", async () => {
    const { lignes } = await calculerLignesPaie(9, 2026);
    const de = (id: string) => lignes.find((l) => l.employee.id === id)!.data;
    expect(baseNette(de(ids.martine))).toBe("400.00");
    expect(baseNette(de(ids.syntyche))).toBe("200.00");
    expect(baseNette(de(ids.marie))).toBe("200.00");
    expect(de(ids.martine)).toMatchObject({ sourceReference: "PLANNING", heuresContractuelles: 216, avertissementsPaie: [] });
    expect(de(ids.syntyche)).toMatchObject({ heuresContractuelles: 156, joursPayesNonTravailles: 9, heuresPayeesNonTravaillees: 54 });
    expect(de(ids.marie)).toMatchObject({ heuresContractuelles: 208, joursPayesNonTravailles: 12, heuresPayeesNonTravaillees: 96 });
  });

  it("semaine sans créneau → repli sur le contrat, motif et avertissement visibles", async () => {
    const l = (await calculerLignesPaie(9, 2026)).lignes.find((x) => x.employee.id === ids.semaineVide)!.data;
    expect(l.sourceReference).toBe("CONTRAT_REPLI");
    expect(l.motifReference).toBe("Planning incomplet : semaine du 21/09 sans créneau");
    expect(l.heuresContractuelles).toBe(208);
    expect(l.avertissementsPaie.map((a) => a.code)).toEqual(["REPLI_CONTRAT"]);
  });

  it("juillet 2026 (avant la date d'effet) → ancienne référence contrat", async () => {
    const l = (await calculerLignesPaie(7, 2026)).lignes.find((x) => x.employee.id === ids.martine)!.data;
    expect(l.sourceReference).toBe("CONTRAT");
    expect(l.heuresContractuelles).toBe(234); // 54 × 52/12
    expect(l.avertissementsPaie).toEqual([]);
  });

  it("semaine à cheval, octobre déjà planifié → 12 h retenues : 184,62 (jamais 160,00)", async () => {
    const l = (await calculerLignesPaie(9, 2026)).lignes.find((x) => x.employee.id === ids.cheval)!.data;
    expect(l.sourceReference).toBe("PLANNING");
    expect(l.heuresContractuelles).toBe(156); // 144 h planifiées + 12 h (et non 36)
    expect(baseNette(l)).toBe("184.62");
    expect(l.avertissementsPaie).toEqual([]); // octobre planifié : rien à signaler
  });

  it("férié HORS du mois hors des heures planifiées de la semaine → 36 h retenues : 153,85 (jamais 166,67)", async () => {
    const l = (await calculerLignesPaie(9, 2026)).lignes.find((x) => x.employee.id === ids.ferieHors)!.data;
    expect(l.sourceReference).toBe("PLANNING");
    expect(l.heuresContractuelles).toBe(156); // 120 h planifiées + 36 h
    expect(baseNette(l)).toBe("153.85");
  });

  it("congé sans solde approuvé, un jour recodé C → non payé : 160,00 (jamais 168,00), signalé", async () => {
    const l = (await calculerLignesPaie(9, 2026)).lignes.find((x) => x.employee.id === ids.sansSolde)!.data;
    expect(l.sourceReference).toBe("PLANNING");
    expect(l.heuresContractuelles).toBe(208);
    expect(l.heuresPayeesNonTravaillees).toBe(0);
    expect(baseNette(l)).toBe("160.00");
    expect(l.avertissementsPaie).toEqual([{ code: "CONGE_SANS_SOLDE_RECODE", message: "Congé sans solde approuvé mais code C le 16/09 : traité comme sans solde" }]);
  });

  it("CDD fini le 18/09, Repos ensuite → repli sur le contrat : 128,00 (jamais 208,00)", async () => {
    const l = (await calculerLignesPaie(9, 2026)).lignes.find((x) => x.employee.id === ids.finCdd)!.data;
    expect(l.sourceReference).toBe("CONTRAT_REPLI");
    expect(l.motifReference).toBe("Fin de contrat le 18/09/2026 : mois incomplet");
    expect(baseNette(l)).toBe("128.00"); // 16 jours × 8 h au taux du contrat (1 $/h)
    expect(l.avertissementsPaie).toEqual([{ code: "REPLI_CONTRAT", message: "Référence contrat (repli) — Fin de contrat le 18/09/2026 : mois incomplet" }]);
  });

  it("CDD échu le 01/09 et poursuivi → payé sur le planning (208,00), signalé", async () => {
    const l = (await calculerLignesPaie(9, 2026)).lignes.find((x) => x.employee.id === ids.cddEchu)!.data;
    expect(l.sourceReference).toBe("PLANNING");
    expect(baseNette(l)).toBe("208.00");
    expect(l.avertissementsPaie).toEqual([{ code: "CDD_ECHU_POURSUIVI", message: "CDD échu le 01/09/2026 sans renouvellement enregistré : le salarié a continué à travailler." }]);
  });

  // Spec §5 « Un seul calcul » : la fiche et le lot lisent les MÊMES données par le MÊME chemin. On
  // compare chaque salarié du fichier (Martine, semaine à cheval, férié hors mois, congé sans solde
  // recodé, fin de CDD, CDD échu…), en septembre (nouvelle règle) ET en juillet (ancienne règle).
  it("l'aperçu de la fiche (bulletin-live) est égal au lot, au centime, avertissements compris", async () => {
    expect(Object.values(ids).filter(Boolean)).toHaveLength(9);
    for (const mois of [9, 7]) {
      const { lignes } = await calculerLignesPaie(mois, 2026);
      for (const [nom, id] of Object.entries(ids)) {
        const lot = lignes.find((l) => l.employee.id === id)!.data;
        const live = (await calculerBulletinLive(id, mois, 2026))!;
        const argent = (x: { salNetUSD: number; salBrutUSD: number; remuneration100: number; remuneration2_3: number; cnssSalarieUSD: number; iprCalculeUSD: number; allocFamilialeUSD: number }) =>
          [x.salNetUSD, x.salBrutUSD, x.remuneration100, x.remuneration2_3, x.cnssSalarieUSD, x.iprCalculeUSD, x.allocFamilialeUSD].map((n) => Number(n).toFixed(2));
        expect(argent(live.ligne), `${nom} ${mois}/2026`).toEqual(argent(lot));
        expect(live.transportUSD.toFixed(2), `${nom} ${mois}/2026`).toBe(lot.transportUSD.toFixed(2));
        expect([live.heuresTravaillees, live.hs30, live.hs60, live.hs100], `${nom} ${mois}/2026`).toEqual([lot.heuresTravaillees, lot.heuresSupp30, lot.heuresSupp60, lot.heuresSupp100]);
        expect(live.reference, `${nom} ${mois}/2026`).toMatchObject({
          heuresReference: lot.heuresContractuelles,
          source: lot.sourceReference,
          motif: lot.motifReference,
          avertissements: lot.avertissementsPaie,
        });
      }
    }
    // La comparaison des avertissements n'est pas vide : les cas signalés arrivent jusqu'à la fiche.
    expect((await calculerBulletinLive(ids.sansSolde, 9, 2026))!.reference.avertissements.map((a) => a.code)).toEqual(["CONGE_SANS_SOLDE_RECODE"]);
    expect((await calculerBulletinLive(ids.cddEchu, 9, 2026))!.reference.avertissements.map((a) => a.code)).toEqual(["CDD_ECHU_POURSUIVI"]);
    expect((await calculerBulletinLive(ids.martine, 9, 2026))!.ligne.salNetUSD.toFixed(2)).not.toBe("369.23");
  });

  it("la carte d'aperçu dit la référence et affiche les avertissements", async () => {
    const martine = renderToStaticMarkup(ApercuBulletinCard({ apercu: (await calculerBulletinLive(ids.martine, 9, 2026))!, periode: "septembre 2026" }));
    // La ligne de référence elle-même (« 216h » seul figure déjà dans « Travaillées »).
    expect(martine).toMatch(/Heures planifiées<\/span><span[^>]*>216h</);
    const vide = renderToStaticMarkup(ApercuBulletinCard({ apercu: (await calculerBulletinLive(ids.semaineVide, 9, 2026))!, periode: "septembre 2026" }));
    expect(vide).toContain("Heures contrat (repli)");
    expect(vide).toContain("Planning incomplet : semaine du 21/09 sans créneau");
    const juillet = renderToStaticMarkup(ApercuBulletinCard({ apercu: (await calculerBulletinLive(ids.martine, 7, 2026))!, periode: "juillet 2026" }));
    expect(juillet).toMatch(/Heures \/ mois<\/span><span[^>]*>234h</);
    expect(juillet).not.toContain("Heures planifiées");
  });

  it("persistance : la ligne enregistrée porte la source, le motif et les avertissements", async () => {
    await rafraichirPaieDuMois({ creerRun: true, userId });
    const martine = await prisma.payrollLine.findFirstOrThrow({ where: { employeeId: ids.martine } });
    expect(martine.sourceReference).toBe("PLANNING");
    expect(Number(martine.heuresContractuelles)).toBe(216);
    expect(martine.avertissementsPaie).toEqual([]);
    const vide = await prisma.payrollLine.findFirstOrThrow({ where: { employeeId: ids.semaineVide } });
    expect(vide.sourceReference).toBe("CONTRAT_REPLI");
    expect(vide.motifReference).toBe("Planning incomplet : semaine du 21/09 sans créneau");
    expect(vide.avertissementsPaie).toEqual([{ code: "REPLI_CONTRAT", message: "Référence contrat (repli) — Planning incomplet : semaine du 21/09 sans créneau" }]);
  });

  it("une ligne VALIDÉE n'est jamais recalculée, même si le planning ou les heures changent", async () => {
    const avant = await prisma.payrollLine.findFirstOrThrow({ where: { employeeId: ids.martine } });
    await prisma.payrollLine.update({ where: { id: avant.id }, data: { statutPaiement: "VALIDE" } });
    await prisma.overtimeEntry.deleteMany({ where: { employeeId: ids.martine, date: d(30) } });
    await rafraichirPaieDuMois({ creerRun: false });
    const apres = await prisma.payrollLine.findFirstOrThrow({ where: { employeeId: ids.martine } });
    expect(apres.id).toBe(avant.id);
    expect(apres.salNetUSD.toString()).toBe(avant.salNetUSD.toString());
  });
});

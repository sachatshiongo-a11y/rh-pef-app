import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient, Role } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";
import { deposerAncienneDemandeMouvement } from "@/lib/test/ancienne-demande-mouvement";

// LA PASTILLE « À VALIDER » EST À JOUR TOUT DE SUITE (Direction, 13/10/2026) — preuve sur une base éphémère, avec les
// VRAIS chargeurs de compteurs (donc leur cache de 20 s) et les VRAIES actions serveur. Le test ne vide JAMAIS le cache
// à la main entre deux lectures : c'est l'action elle-même qui doit le faire, sinon la pastille garde l'ancien chiffre.
//
// Méthode pour chaque geste : (1) lire la pastille de la Direction — le cache est chaud ; (2) décider (ou créer) ;
// (3) relire AU MÊME INSTANT : le chiffre doit avoir bougé. Sans l'appel à `reinitialiserCacheAValider()` dans l'action,
// l'étape 3 renverrait le chiffre de l'étape 1 pendant 20 s.

const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient, barriere: null as null | Promise<void> }));
const A = vi.hoisted(() => ({ user: { id: "", email: "", nom: "", role: "ADMIN" as string, accesStock: false, employeeId: null as string | null } }));

vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      // Barrière de test : suspend le comptage des congés (lecture du cache RH) tant qu'elle est posée.
      if (p === "leaveRequest") {
        return new Proxy(v as object, {
          get: (cible, m) => {
            const f = (cible as Record<string | symbol, unknown>)[m];
            if (m !== "count" || typeof f !== "function") return typeof f === "function" ? (f as (...a: unknown[]) => unknown).bind(cible) : f;
            return async (...args: unknown[]) => { const r = await (f as (...a: unknown[]) => Promise<unknown>).apply(cible, args); if (H.barriere) await H.barriere; return r; };
          },
        });
      }
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));
vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), verifySession: async () => A.user }));
vi.mock("@/lib/espace-employe", () => ({ espaceEmployeActif: async () => true }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw Object.assign(new Error(`REDIRECT ${url}`), { digest: `NEXT_REDIRECT;${url}`, url }); },
  notFound: () => { throw Object.assign(new Error("NOT_FOUND"), { digest: "NEXT_NOT_FOUND" }); },
}));
vi.mock("@/lib/push", () => ({ envoyerPush: async () => {} }));
vi.mock("@/lib/email", () => ({ envoyerEmail: async () => {} }));
vi.mock("@/lib/contrats-notification", () => ({ notifierContratASigner: async () => {}, notifierSiContratARevoir: async () => {} }));

const CONGES = await import("./(app)/conges/actions");
const REMU = await import("./(app)/paie/remuneration-actions");
const ATT = await import("./(app)/attestations/actions");
const FICHES = await import("./(app)/a-valider/fiche-actions");
const STOCK = await import("./(stock)/stock/a-valider/actions");
const ESPACE = await import("./espace/actions");
const CHARGEURS = await import("@/lib/a-valider-chargeurs");

let prisma: PrismaClient;
let fermer: () => Promise<void>;

type Compte = "DIR" | "MGR" | "STK" | "EMP";
const ROLES: Record<Compte, Role> = { DIR: "ADMIN", MGR: "MANAGER", STK: "STOCK", EMP: "EMPLOYE" };
const ids = {} as Record<Compte, string>;
const cpt = (c: Compte) => ({ id: ids[c], role: ROLES[c], accesStock: false });
function en(c: Compte, employeeId: string | null = null) { A.user = { id: ids[c], email: `${c}@pef.test`, nom: c, role: ROLES[c], accesStock: false, employeeId }; }
/** La pastille unique de la Direction (RH + Stock + Exploitation), lue À TRAVERS le cache. */
const pastilleDirection = () => CHARGEURS.chargerTotalAValider(cpt("DIR"));
/** Le geste change le chiffre de `delta` — sans que le test ait vidé le cache. */
async function pastilleBouge(delta: number, geste: () => Promise<unknown>) {
  const avant = await pastilleDirection(); // cache chaud
  await geste();
  expect(await pastilleDirection()).toBe(avant + delta);
}

let seq = 0;
async function creerEmploye(nom: string) {
  return (await prisma.employee.create({
    data: { matricule: `K-${++seq}`, nom, sexe: "F", etatCivil: "Célibataire", poste: "Commis", secteur: "Cuisine", categorie: "BRIGADE", salaireMensuel: 300, dateEmbauche: new Date("2025-01-01"), contrat: "CDI" },
  })).id;
}
const conge = (employeeId: string, jour: number) => prisma.leaveRequest.create({
  data: { employeeId, type: "Congé annuel", dateDebut: new Date(`2026-11-${String(jour).padStart(2, "0")}`), dateFin: new Date(`2026-11-${String(jour).padStart(2, "0")}`), nbJours: 1 },
}).then((x) => x.id);
const acompte = (employeeId: string, montantUSD = 20) => prisma.acompteSalaire.create({ data: { employeeId, montantUSD, mois: 10, annee: 2026 } }).then((x) => x.id);
const versions = async () => Object.fromEntries((await prisma.demandeValidationStock.findMany({ select: { id: true, updatedAt: true } })).map((x) => [x.id, x.updatedAt.toISOString()]));

let emp: string;
let empB: string;

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  for (const c of Object.keys(ROLES) as Compte[]) ids[c] = (await prisma.user.create({ data: { email: `${c.toLowerCase()}@pef.test`, nom: c, role: ROLES[c] } })).id;
  emp = await creerEmploye("Employe Cache Un");
  empB = await creerEmploye("Employe Cache Deux");
  await prisma.config.create({ data: { id: "singleton", tauxChangeCDF: 2800, anneeCourante: 2026, moisCourant: 10 } });
}, 180_000);
afterAll(async () => { await fermer?.(); });

describe("pastille « À valider » — à jour tout de suite après chaque décision (cache de 20 s vidé par l'action)", () => {
  it("le cache est bien chaud : sans écriture par une action, deux lectures rapprochées donnent le MÊME chiffre (la preuve ci-dessous a un sens)", async () => {
    const avant = await pastilleDirection();
    await acompte(emp); // écriture directe en base, SANS action : le cache ne le voit pas
    expect(await pastilleDirection()).toBe(avant);
    CHARGEURS.reinitialiserCacheAValider();
    expect(await pastilleDirection()).toBe(avant + 1);
    await prisma.acompteSalaire.deleteMany({});
    CHARGEURS.reinitialiserCacheAValider();
  });

  it("CONGÉ : approuver, refuser, approuver en lot, refuser en lot, supprimer — la pastille baisse immédiatement", async () => {
    en("DIR");
    const [c1, c2, c3, c4, c5] = [await conge(emp, 2), await conge(emp, 3), await conge(emp, 4), await conge(empB, 5), await conge(empB, 6)];
    CHARGEURS.reinitialiserCacheAValider();
    await pastilleBouge(-1, () => CONGES.approuverConge(c1));
    await pastilleBouge(-1, () => CONGES.refuserConge(c2, "Période chargée"));
    await pastilleBouge(-2, () => CONGES.approuverCongesEnLot([c3, c4]));
    await pastilleBouge(-1, () => CONGES.refuserCongesEnLot([c5], "Période chargée"));
    const c6 = await conge(emp, 9);
    CHARGEURS.reinitialiserCacheAValider();
    await pastilleBouge(-1, () => CONGES.supprimerConge(c6));
  });

  it("CONGÉ, création : la demande d'un Responsable RH fait monter la pastille tout de suite", async () => {
    en("MGR");
    const f = new FormData();
    f.set("employeeId", empB); f.set("type", "Congé annuel"); f.set("dateDebut", "2026-11-16"); f.set("dateFin", "2026-11-16"); f.set("nbJours", "1");
    const typeConge = await prisma.typeConge.findFirst({ where: { nom: "Congé annuel" } });
    if (!typeConge) await prisma.typeConge.create({ data: { nom: "Congé annuel", joursPayes: 1, tauxPct: 100, compteDansSolde: true } });
    CHARGEURS.reinitialiserCacheAValider();
    await pastilleBouge(+1, async () => { try { await CONGES.demanderConge(f); } catch { /* redirection éventuelle du formulaire */ } });
    expect(await prisma.leaveRequest.count({ where: { employeeId: empB, statut: "EN_ATTENTE" } })).toBe(1);
  });

  it("ACOMPTE : approuver, refuser, approuver en lot, supprimer — la pastille baisse immédiatement", async () => {
    en("DIR");
    const [a1, a2, a3, a4, a5] = [await acompte(emp), await acompte(emp), await acompte(empB), await acompte(empB), await acompte(emp)];
    CHARGEURS.reinitialiserCacheAValider();
    await pastilleBouge(-1, () => REMU.approuverAcompte(a1));
    await pastilleBouge(-1, () => REMU.refuserAcompte(a2));
    await pastilleBouge(-2, () => REMU.approuverAcomptesEnLot([a3, a4]));
    await pastilleBouge(-1, () => REMU.supprimerAcompte(a5));
  });

  it("ACOMPTE, demande du salarié (espace) : la pastille de la Direction monte tout de suite", async () => {
    en("EMP", emp);
    await prisma.user.update({ where: { id: ids.EMP }, data: { employeeId: emp } });
    const f = new FormData();
    f.set("montantUSD", "10");
    CHARGEURS.reinitialiserCacheAValider();
    await pastilleBouge(+1, async () => { try { await ESPACE.demanderMonAcompte(f); } catch { /* redirection de succès */ } });
    expect(await prisma.acompteSalaire.count({ where: { employeeId: emp, statut: "EN_ATTENTE", montantUSD: 10 } })).toBe(1);
  });

  it("ATTESTATION : refuser (et en lot) — la pastille baisse immédiatement", async () => {
    en("DIR");
    const a1 = (await prisma.attestation.create({ data: { employeeId: emp, type: "TRAVAIL" } })).id;
    const a2 = (await prisma.attestation.create({ data: { employeeId: empB, type: "TRAVAIL" } })).id;
    CHARGEURS.reinitialiserCacheAValider();
    await pastilleBouge(-1, () => ATT.refuserAttestations([a1], "Dossier incomplet"));
    await pastilleBouge(-1, () => ATT.refuserAttestations([a2], "Dossier incomplet"));
  });

  it("DEMANDE DE FICHE (modification) : refuser — la pastille baisse immédiatement", async () => {
    en("DIR");
    const d = (await prisma.demandeModifFiche.create({
      data: { employeeId: emp, origine: "MODIFIER", changements: [{ champ: "salaireMensuel", avant: "300", apres: "350" }], auteurId: ids.MGR, auteurNom: "MGR" },
    })).id;
    CHARGEURS.reinitialiserCacheAValider();
    await pastilleBouge(-1, () => FICHES.refuserModifsFiche([d], "Hors grille"));
  });

  it("DEMANDE DU STOCK : valider, refuser — la pastille baisse immédiatement", async () => {
    en("DIR");
    const article = async (designation: string) => {
      const a = await prisma.articleStock.create({ data: { designation, domaine: "NOURRITURE", unite: "Kg", prixUnitaireUSD: 2 } });
      await prisma.stock.create({ data: { articleId: a.id, quantite: 10, stockMinimum: 1 } });
      return a.id;
    };
    const depot = async (origine: string, designation: string) =>
      (await deposerAncienneDemandeMouvement(prisma, { auteur: { id: ids.STK, nom: "STK" }, type: "ENTREE", date: "2026-10-05", origine, lignes: [[await article(designation), 1]] })).id;
    const [d1, d2] = [await depot("Cache Un", "Farine Cache"), await depot("Cache Deux", "Sucre Cache")];
    CHARGEURS.reinitialiserCacheAValider();
    await pastilleBouge(-1, async () => STOCK.validerDemandes([d1], {}, await versions()));
    await pastilleBouge(-1, async () => STOCK.refuserDemandes([d2], "Déjà compté", await versions()));
  });

  it("une lecture partie AVANT une décision ne remet pas en cache un chiffre devenu périmé (compteur de génération)", async () => {
    en("DIR");
    const c = await conge(emp, 23);
    CHARGEURS.reinitialiserCacheAValider();
    let lacher!: () => void;
    H.barriere = new Promise<void>((r) => { lacher = r; });
    const lectureLente = CHARGEURS.chargerElementsAValiderRH(); // a déjà compté les congés (avec `c`), attend la barrière
    await new Promise((r) => setTimeout(r, 300));
    await CONGES.approuverConge(c); // la décision passe PENDANT la lecture : le cache est vidé
    H.barriere = null; lacher();
    const perime = await lectureLente;
    // La lecture lente rend son chiffre périmé à son appelant, mais ne le range PAS en cache : la lecture suivante est à neuf.
    const frais = await CHARGEURS.chargerElementsAValiderRH();
    expect(frais.conges).toBe(perime.conges - 1);
  });
});

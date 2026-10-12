import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PrismaClient, Role } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";
import { deposerAncienneDemandeMouvement } from "@/lib/test/ancienne-demande-mouvement";
import { seederPlanComptable } from "../../prisma/seed-exploitation";

// « À VALIDER » VISIBLE PAR TOUS LES RÔLES (plan d'ergonomie, lot 3, décision V1) — preuve sur une base
// éphémère, avec les VRAIES pages, les VRAIS chargeurs de compteurs et les VRAIES actions serveur ; seule
// la session est simulée (les gardes de rôle et d'espace sont les vrais prédicats).
//
//  0. UNE SEULE PAGE (2026-10-12) : « À valider » est la même page à trois adresses (une par coquille d'espace) ; elle
//     montre les rubriques des espaces DU COMPTE — la Direction en voit les trois, chaque autre rôle son seul espace.
//  1. PASTILLE PAR RÔLE : la Direction compte toute la file de tous les espaces ; chaque autre rôle compte SES éléments —
//     jamais les demandes des autres (annexe D). Le compteur « En attente » de la page est le même chiffre.
//  2. PAGES : un autre rôle y lit SES demandes (statut, motif du refus), jamais celles des autres, et n'a
//     AUCUN bouton de décision (ni case à cocher) ; la Direction a les siens (contre-épreuve).
//  3. REFUS SERVEUR : chaque action de décision, appelée directement par un compte qui contourne l'écran,
//     est refusée et n'écrit rien.
//  4. SÉLECTEUR D'ESPACE : « N à valider » sur les cartes de la Direction seulement, mêmes chiffres que les badges.

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
// Seule la session est simulée : requireRole / requireModule / espacesDe sont les vrais.
vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), verifySession: async () => A.user }));
vi.mock("@/lib/espace-employe", () => ({ espaceEmployeActif: async () => true }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("next/link", () => ({
  default: ({ href, children, prefetch: _p, ...rest }: { href: string; children: React.ReactNode; prefetch?: boolean }) => createElement("a", { href, ...rest }, children),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw Object.assign(new Error(`REDIRECT ${url}`), { digest: `NEXT_REDIRECT;${url}`, url }); },
  notFound: () => { throw Object.assign(new Error("NOT_FOUND"), { digest: "NEXT_NOT_FOUND" }); },
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, prefetch: () => {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/formulaire-deconnexion", () => ({ FormulaireDeconnexion: () => null }));
vi.mock("@/lib/push", () => ({ envoyerPush: async () => {} }));
vi.mock("@/lib/contrats-notification", () => ({ notifierContratASigner: async () => {}, notifierSiContratARevoir: async () => {} }));

const FICHES = await import("./(app)/a-valider/fiche-actions");
const CONGES = await import("./(app)/conges/actions");
const REMU = await import("./(app)/paie/remuneration-actions");
const ATT = await import("./(app)/attestations/actions");
const PAIE = await import("./(app)/paie/actions");
const SHIFTS = await import("./(app)/planning/decisions-lot-actions");
const STOCK = await import("./(stock)/stock/a-valider/actions");
const BC = await import("./(stock)/stock/commandes/actions");
const RATIOS = await import("./(exploitation)/exploitation/plan-comptable/actions");
const CHARGEURS = await import("@/lib/a-valider-chargeurs");
const { modifierOuDemanderRatios, refuserDemandesRatios } = await import("@/lib/exploitation/demandes-ratios");
const PAGE_RH = (await import("./(app)/a-valider/page")).default;
const PAGE_STOCK = (await import("./(stock)/stock/a-valider/page")).default;
const PAGE_EXPLOITATION = (await import("./(exploitation)/exploitation/a-valider/page")).default;
const PAGE_PLAN = (await import("./(exploitation)/exploitation/plan-comptable/page")).default;
const PAGE_CHOIX = (await import("./choix-espace/page")).default;

let prisma: PrismaClient;
let fermer: () => Promise<void>;

type Compte = "DIR" | "MGR" | "MGR2" | "VIEW" | "STK" | "STK2" | "CPT" | "CPT2" | "EMP" | "EMPS";
const COMPTES: Record<Compte, { role: Role; nom: string }> = {
  DIR: { role: "ADMIN", nom: "Direction" },
  MGR: { role: "MANAGER", nom: "Responsable Un" },
  MGR2: { role: "MANAGER", nom: "Responsable Deux" },
  VIEW: { role: "VIEWER", nom: "Consultation" },
  STK: { role: "STOCK", nom: "Magasinier Un" },
  STK2: { role: "STOCK", nom: "Magasinier Deux" },
  CPT: { role: "COMPTA", nom: "Compta Un" },
  CPT2: { role: "COMPTA", nom: "Compta Deux" },
  EMP: { role: "EMPLOYE", nom: "Salarie Simple" },
  EMPS: { role: "EMPLOYE", nom: "Salarie Accès Stock" }, // salarié à qui l'accès Stock a été accordé (session : accesStock)
};
const ids = {} as Record<Compte, string>;

function en(c: Compte, employeeId: string | null = null) {
  A.user = { id: ids[c], email: `${c}@pef.test`, nom: COMPTES[c].nom, role: COMPTES[c].role, accesStock: c === "EMPS", employeeId };
}
/** Le compte tel que les chargeurs le reçoivent (rôle + accès Stock accordé). */
const cpt = (c: Compte) => ({ id: ids[c], role: COMPTES[c].role, accesStock: c === "EMPS" });
/** La pastille unique d'un compte : le total de tous ses espaces. */
const pastille = async (c: Compte) => (await CHARGEURS.chargerTotalAValider(cpt(c)));
/** Une page rendue pour un compte, ou l'adresse où sa garde le renvoie. */
async function ouRenvoye(Page: (p: { searchParams: Promise<Record<string, string>> }) => Promise<React.ReactElement>): Promise<string | null> {
  try { await Page({ searchParams: Promise.resolve({}) }); return null; } catch (e) { return (e as { url?: string }).url ?? null; }
}

/** Le refus d'une action (valeur `{ erreur }`, `?erreur=` de page ou erreur levée), ou null si elle a réussi. */
async function tenter(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    const r = await fn();
    if (typeof r === "object" && r !== null && "erreur" in r) return String((r as { erreur: unknown }).erreur);
    return null;
  } catch (e) {
    const url = (e as { url?: string }).url;
    if (url !== undefined) { const m = /[?&]erreur=([^&]*)/.exec(url); return m ? decodeURIComponent(m[1]) : null; }
    return e instanceof Error ? e.message : String(e);
  }
}

const page = async (Page: (p: { searchParams: Promise<Record<string, string>> }) => Promise<React.ReactElement>) =>
  renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }));
const enAttente = (html: string) => Number(/En attente<\/p><p[^>]*>(\d+)<\/p>/.exec(html)?.[1] ?? NaN);
/** Un bouton de décision (✓ approuver/valider, ✕ refuser), une case à cocher ou un libellé de décision. */
const aDesBoutonsDeDecision = (html: string) => /✓|✕|Approuver|Refuser|\bValider\b/.test(html);

// Identifiants des éléments semés.
const S = {} as {
  emp: Record<"e1" | "e2" | "e3" | "e4" | "e5" | "e6" | "e7", string>;
  modifMgr: string; modifMgr2: string; creationMgr2: string; refuseeMgr: string;
  conge: string; acompte: string; attestation: string; ligneAValider: string; ligneAPayer: string;
  bon: string; demandeStk: string; demandeStk2: string; refuseeStk: string;
  ratiosCpt: string; ratiosCpt2: string; ratiosRefusee: string;
};

let seq = 0;
async function creerEmploye(nom: string) {
  return (await prisma.employee.create({
    data: {
      matricule: `A-${++seq}`, nom, sexe: "F", etatCivil: "Célibataire", poste: "Commis", secteur: "Cuisine", categorie: "BRIGADE",
      salaireMensuel: 300, dateEmbauche: new Date("2025-01-01"), contrat: "CDI",
    },
  })).id;
}
const changement = [{ champ: "salaireMensuel", avant: "300", apres: "350" }];
const ligne = (payrollRunId: string, employeeId: string, statutPaiement: "PAS_VALIDE" | "VALIDE") => prisma.payrollLine.create({
  data: {
    payrollRunId, employeeId, statutPaiement, salBrutUSD: 300, cnssSalarieUSD: 15, netImposableUSD: 285, iprCalculeUSD: 10, allocFamilialeUSD: 0,
    salNetUSD: 270, salNetCDF: 756000, cnssPatronalUSD: 30, coutEmployeurUSD: 330, coutEmployeurCDF: 924000,
  },
});

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  for (const c of Object.keys(COMPTES) as Compte[]) {
    ids[c] = (await prisma.user.create({ data: { email: `${c.toLowerCase()}@pef.test`, nom: COMPTES[c].nom, role: COMPTES[c].role } })).id;
  }
  await seederPlanComptable(prisma);

  // ── RH ────────────────────────────────────────────────────────────────────────────────────────
  S.emp = {
    e1: await creerEmploye("Employe Marque Un"), e2: await creerEmploye("Employe Marque Deux"), e3: await creerEmploye("Employe Marque Trois"),
    e4: await creerEmploye("Employe Marque Quatre"), e5: await creerEmploye("Employe Marque Cinq"), e6: await creerEmploye("Employe Marque Six"),
    e7: await creerEmploye("Employe Marque Sept"),
  };
  const auteur = (c: Compte) => ({ auteurId: ids[c], auteurNom: COMPTES[c].nom });
  S.modifMgr = (await prisma.demandeModifFiche.create({ data: { employeeId: S.emp.e1, origine: "MODIFIER", changements: changement, ...auteur("MGR") } })).id;
  S.modifMgr2 = (await prisma.demandeModifFiche.create({ data: { employeeId: S.emp.e2, origine: "MODIFIER", changements: changement, ...auteur("MGR2") } })).id;
  S.creationMgr2 = (await prisma.demandeCreationFiche.create({ data: { nom: "Nouvelle Recrue Marquee", donnees: {}, ...auteur("MGR2") } })).id;
  S.refuseeMgr = (await prisma.demandeModifFiche.create({
    data: { employeeId: S.emp.e7, origine: "MODIFIER", changements: changement, statut: "REFUSEE", motifRefus: "Salaire hors grille", decideurNom: "Direction", decideLe: new Date(), ...auteur("MGR") },
  })).id;
  S.conge = (await prisma.leaveRequest.create({ data: { employeeId: S.emp.e3, type: "Congé annuel", dateDebut: new Date("2026-11-02"), dateFin: new Date("2026-11-03"), nbJours: 2 } })).id;
  S.acompte = (await prisma.acompteSalaire.create({ data: { employeeId: S.emp.e4, montantUSD: 20, mois: 10, annee: 2026 } })).id;
  S.attestation = (await prisma.attestation.create({ data: { employeeId: S.emp.e3, type: "TRAVAIL" } })).id;
  const run = await prisma.payrollRun.create({ data: { mois: 10, annee: 2026, tauxChangeUtilise: 2800 } });
  S.ligneAValider = (await ligne(run.id, S.emp.e5, "PAS_VALIDE")).id;
  S.ligneAPayer = (await ligne(run.id, S.emp.e6, "VALIDE")).id;

  // ── Stock ─────────────────────────────────────────────────────────────────────────────────────
  S.bon = (await prisma.bonDeCommande.create({ data: { numero: "001/PEF/OCT/26", sequence: 1, annee: 2026, mois: 10 } })).id;
  // Une seule demande en attente par article (verrou de la base) : un article par magasinier.
  const article = async (designation: string) => {
    const a = await prisma.articleStock.create({ data: { designation, domaine: "NOURRITURE", unite: "Kg", prixUnitaireUSD: 2 } });
    await prisma.stock.create({ data: { articleId: a.id, quantite: 10, stockMinimum: 1 } });
    return a.id;
  };
  const depot = async (c: Compte, origine: string, designation: string) =>
    deposerAncienneDemandeMouvement(prisma, { auteur: { id: ids[c], nom: COMPTES[c].nom }, type: "ENTREE", date: "2026-10-05", origine, lignes: [[await article(designation), 1]] });
  S.demandeStk = (await depot("STK", "Marque Stock Un", "Farine Marquee")).id;
  S.demandeStk2 = (await depot("STK2", "Marque Stock Deux", "Sucre Marque")).id;
  S.refuseeStk = (await prisma.demandeValidationStock.create({
    data: { nature: "MOUVEMENT_MANUEL", statut: "REFUSEE", resume: "Entrée refusée marquée", charge: {}, motifRefus: "Stock déjà compté", decideurNom: "Direction", decideLe: new Date(), ...auteur("STK") },
  })).id;

  // ── Exploitation ──────────────────────────────────────────────────────────────────────────────
  const [rubA, rubB, rubC] = await prisma.rubrique.findMany({ where: { sens: "DEPENSE" }, orderBy: { ordre: "asc" }, take: 3 });
  const acteur = (c: Compte) => ({ id: ids[c], nom: COMPTES[c].nom, role: COMPTES[c].role });
  const cible = { ratioIdeal: 0.2, ratioMax: 0.28, ratioIdealAnnuel: null, ratioMaxAnnuel: null };
  S.ratiosCpt = (await modifierOuDemanderRatios(acteur("CPT"), rubA.id, cible) as { id: string }).id;
  S.ratiosCpt2 = (await modifierOuDemanderRatios(acteur("CPT2"), rubB.id, cible) as { id: string }).id;
  S.ratiosRefusee = (await modifierOuDemanderRatios(acteur("CPT"), rubC.id, cible) as { id: string }).id;
  await refuserDemandesRatios([S.ratiosRefusee], "Ratio trop bas", acteur("DIR"));
}, 180_000);
afterAll(async () => { await fermer?.(); });

describe("pastille unique — chacun compte SES éléments, tous espaces confondus ; la Direction toute la file", () => {
  it("RH (par espace) : Direction 8 (toute la file), Responsable RH = ses demandes de fiche + les bulletins qu'il paie, consultation 0", async () => {
    CHARGEURS.reinitialiserCacheAValider();
    const rh = async (c: Compte) => (await CHARGEURS.chargerAValiderRH(cpt(c))).total;
    expect(await rh("DIR")).toBe(8); // congé 1 + fiches 3 + acompte 1 + attestation 1 + bulletin à valider 1 + bulletin à payer 1
    expect(await rh("MGR")).toBe(2); // sa demande de fiche + le bulletin à payer — pas la demande de MGR2, ni le congé, ni l'acompte
    expect(await rh("MGR2")).toBe(3); // ses deux demandes de fiche + le bulletin à payer
    expect(await rh("VIEW")).toBe(0);
  });

  it("Stock (par espace) : la Direction compte tout, le magasinier ses seules demandes (+ les bons en brouillon, communs au Stock)", async () => {
    const total = async (c: Compte) => (await CHARGEURS.chargerAValiderStock(cpt(c))).total;
    expect(await total("DIR")).toBe(3); // 1 bon + 2 demandes
    expect(await total("STK")).toBe(2); // 1 bon + SA demande
    expect(await total("STK2")).toBe(2);
  });

  it("Exploitation (par espace) : la Direction compte toutes les demandes de ratios, la Compta les siennes", async () => {
    const total = async (c: Compte) => CHARGEURS.chargerAValiderExploitation(cpt(c));
    expect(await total("DIR")).toBe(2);
    expect(await total("CPT")).toBe(1);
    expect(await total("CPT2")).toBe(1);
  });

  it("LA PASTILLE d'un compte = la somme des espaces du compte : Direction 8 + 3 + 2, les autres leur seul espace, un salarié simple 0", async () => {
    CHARGEURS.reinitialiserCacheAValider();
    expect(await pastille("DIR")).toBe(13);
    expect(await pastille("MGR")).toBe(2);
    expect(await pastille("MGR2")).toBe(3);
    expect(await pastille("VIEW")).toBe(0);
    expect(await pastille("STK")).toBe(2);
    expect(await pastille("STK2")).toBe(2);
    expect(await pastille("CPT")).toBe(1);
    expect(await pastille("CPT2")).toBe(1);
    expect(await pastille("EMP")).toBe(0);
    expect(await pastille("EMPS")).toBe(1); // le salarié avec accès Stock : le bon en brouillon, commun au Stock — pas de demande à lui
  });

  it("le détail : un espace qui n'est pas au compte n'est PAS lu (null), pas même compté zéro", async () => {
    const d = await CHARGEURS.chargerAValiderDuCompte(cpt("STK"));
    expect(d.espaces).toEqual({ rh: false, stock: true, exploitation: false });
    expect(d.rh).toBeNull();
    expect(d.exploitation).toBeNull();
    expect(d.parEspace).toEqual({ rh: 0, stock: 2, exploitation: 0 });
    const dir = await CHARGEURS.chargerAValiderDuCompte(cpt("DIR"));
    expect(dir.parEspace).toEqual({ rh: 8, stock: 3, exploitation: 2 });
  });

  it("le badge « Paie » et le badge « Congés » du menu RH restent ceux d'avant (propres à la RH, selon le rôle)", async () => {
    const badges = (c: Compte) => CHARGEURS.chargerBadgesRH(cpt(c));
    expect(await badges("DIR")).toEqual({ "/a-valider": 13, "/conges": 1, "/paie": 2 }); // à valider 1 + à payer 1
    expect(await badges("MGR")).toEqual({ "/a-valider": 2, "/conges": 1, "/paie": 1 }); // il paie, il ne valide pas ; le badge Congés compte la file entière
    expect(await badges("VIEW")).toEqual({ "/a-valider": 0, "/conges": 1, "/paie": 0 });
  });

  it("le compteur « En attente » de la page est LE chiffre de la pastille — sur chacune des trois adresses ouvertes à ce compte", async () => {
    CHARGEURS.reinitialiserCacheAValider();
    for (const c of ["DIR", "MGR", "MGR2", "VIEW"] as Compte[]) {
      en(c);
      expect(enAttente(await page(PAGE_RH)), `RH ${c}`).toBe(await pastille(c));
    }
    for (const c of ["DIR", "STK", "STK2", "EMPS"] as Compte[]) {
      en(c);
      expect(enAttente(await page(PAGE_STOCK)), `Stock ${c}`).toBe(await pastille(c));
    }
    for (const c of ["DIR", "CPT", "CPT2"] as Compte[]) {
      en(c);
      expect(enAttente(await page(PAGE_EXPLOITATION)), `Exploitation ${c}`).toBe(await pastille(c));
    }
  });
});

describe("page unique — chaque adresse n'est ouverte qu'aux comptes de SON espace (la garde de la page, pas seulement le layout)", () => {
  it("un compte hors de l'espace est renvoyé à l'entrée AVANT toute lecture : STK et CPT sur la coquille RH, MGR sur celle du Stock, STK sur celle de l'Exploitation, EMP partout", async () => {
    const cas: [Compte, typeof PAGE_RH, string][] = [
      ["STK", PAGE_RH, "RH"], ["CPT", PAGE_RH, "RH"], ["EMP", PAGE_RH, "RH"], ["EMPS", PAGE_RH, "RH"],
      ["MGR", PAGE_STOCK, "Stock"], ["VIEW", PAGE_STOCK, "Stock"], ["CPT", PAGE_STOCK, "Stock"], ["EMP", PAGE_STOCK, "Stock"],
      ["STK", PAGE_EXPLOITATION, "Exploitation"], ["MGR", PAGE_EXPLOITATION, "Exploitation"], ["EMP", PAGE_EXPLOITATION, "Exploitation"], ["EMPS", PAGE_EXPLOITATION, "Exploitation"],
    ];
    for (const [c, Page, nom] of cas) {
      en(c);
      expect(await ouRenvoye(Page), `${c} sur ${nom}`).toBe("/entree");
    }
  });

  it("contre-épreuve : les comptes de l'espace, eux, entrent (la Direction par les trois, le salarié avec accès Stock par le Stock)", async () => {
    for (const [c, Page] of [["DIR", PAGE_RH], ["DIR", PAGE_STOCK], ["DIR", PAGE_EXPLOITATION], ["MGR", PAGE_RH], ["STK", PAGE_STOCK], ["EMPS", PAGE_STOCK], ["CPT", PAGE_EXPLOITATION]] as [Compte, typeof PAGE_RH][]) {
      en(c);
      expect(await ouRenvoye(Page), c).toBeNull();
    }
  });
});

describe("pages — chaque rôle lit SES demandes, jamais celles des autres, et ne décide rien", () => {
  it("RH, Responsable RH : sa demande de fiche + la réponse refusée (statut, motif) ; pas celle de MGR2, ni congé, acompte, attestation", async () => {
    en("MGR");
    const html = await page(PAGE_RH);
    expect(html).toContain("<h1");
    expect(html).toContain("À valider");
    expect(html).toContain("Employe Marque Un"); // sa demande en attente
    expect(html).toContain("Employe Marque Sept"); // sa demande refusée
    expect(html).toContain("Refusée");
    expect(html).toContain("Motif : Salaire hors grille");
    for (const marque of ["Employe Marque Deux", "Nouvelle Recrue Marquee", "Employe Marque Trois", "Employe Marque Quatre"]) expect(html, marque).not.toContain(marque);
    // Une page UNIQUE, mais seulement les espaces du compte : ni le Stock ni l'Exploitation, ni leur titre, ni leur contenu.
    expect(html).toContain('id="espace-rh"');
    for (const absent of ['id="espace-stock"', 'id="espace-exploitation"', "Marque Stock", "Compta Un", "Compta Deux", "Farine Marquee"]) expect(html, absent).not.toContain(absent);
    // Les rubriques de la file des salariés ne sont ni listées ni même nommées (« Rien d'autre en attente : demandes de congé… »).
    // Les shifts, eux, sont son geste historique (voir le dernier bloc de ce fichier).
    expect(html).not.toMatch(/congé|acompte|attestation/i);
  });

  it("RH, Responsable RH : aucun bouton de décision sur les fiches ni les bulletins ; ses gestes : « Marquer payé » sur les bulletins validés (et les shifts, plus bas)", async () => {
    en("MGR");
    const html = await page(PAGE_RH);
    expect(html).not.toMatch(/Approuver|Refuser|\bValider\b|✕/);
    expect(html).toContain("Marquer payé");
    expect(html).toContain("Employe Marque Six"); // bulletin à payer
    expect(html).not.toContain("Employe Marque Cinq"); // bulletin à valider : réservé à la Direction
  });

  it("RH, consultation : aucune demande, aucun bouton, aucune case, état vide", async () => {
    en("VIEW");
    const html = await page(PAGE_RH);
    expect(aDesBoutonsDeDecision(html)).toBe(false);
    expect(html).not.toContain("Marquer payé");
    expect(html).not.toContain('type="checkbox"');
    expect(html).toContain("Rien en attente");
    expect(html).not.toMatch(/congé|acompte|attestation|shift|bulletin/i);
    for (const marque of ["Employe Marque", "Nouvelle Recrue Marquee"]) expect(html, marque).not.toContain(marque);
  });

  it("RH, Direction (contre-épreuve) : toute la file des TROIS espaces, les boutons de décision, les cases — sur une seule page", async () => {
    en("DIR");
    const html = await page(PAGE_RH);
    for (const marque of ["Employe Marque Un", "Employe Marque Deux", "Nouvelle Recrue Marquee", "Employe Marque Trois", "Employe Marque Quatre", "Employe Marque Cinq", "Employe Marque Six"]) expect(html, marque).toContain(marque);
    expect(html).toContain("Approuver");
    expect(html).toContain("Refuser");
    expect(html).toContain('type="checkbox"');
    // Un seul « À valider » : les rubriques du Stock et de l'Exploitation sont sur la même page, plus de rappel croisé.
    for (const marque of ["Marque Stock Un", "Marque Stock Deux", "Compta Un", "Compta Deux"]) expect(html, marque).toContain(marque);
    for (const bloc of ['id="espace-rh"', 'id="espace-stock"', 'id="espace-exploitation"']) expect(html, bloc).toContain(bloc);
    expect(html).not.toContain("Aussi en attente");
  });

  it("Stock, magasinier : sa demande, la réponse refusée avec son motif ; pas celle de l'autre magasinier ; aucun bouton de décision", async () => {
    en("STK");
    const html = await page(PAGE_STOCK);
    expect(html).toContain("Marque Stock Un");
    expect(html).toContain("Entrée refusée marquée");
    expect(html).toContain("Motif : Stock déjà compté");
    expect(html).not.toContain("Marque Stock Deux");
    expect(aDesBoutonsDeDecision(html)).toBe(false);
    expect(html).toContain("En attente Direction"); // le bon en brouillon : en lecture
    // Pas d'autre espace que le sien : ni RH, ni Exploitation (ni titre, ni contenu).
    expect(html).toContain('id="espace-stock"');
    for (const absent of ['id="espace-rh"', 'id="espace-exploitation"', "Employe Marque", "Compta Un", "Nouvelle Recrue Marquee"]) expect(html, absent).not.toContain(absent);
  });

  it("Stock, Direction (contre-épreuve) : les deux demandes, les boutons, et — même page — la RH et l'Exploitation", async () => {
    en("DIR");
    const html = await page(PAGE_STOCK);
    expect(html).toContain("Marque Stock Un");
    expect(html).toContain("Marque Stock Deux");
    expect(aDesBoutonsDeDecision(html)).toBe(true);
    for (const marque of ["Employe Marque Un", "Nouvelle Recrue Marquee", "Compta Un", "Compta Deux"]) expect(html, marque).toContain(marque);
  });

  it("Exploitation, Compta : sa demande de ratios et la réponse refusée (motif) ; pas celle de l'autre ; aucun bouton de décision ni case", async () => {
    en("CPT");
    const html = await page(PAGE_EXPLOITATION);
    expect(html).toContain("Compta Un");
    expect(html).toContain("Refusée");
    expect(html).toContain("Motif : Ratio trop bas");
    expect(html).not.toContain("Compta Deux");
    expect(html).not.toMatch(/Approuver|Refuser|✕/);
    expect(html).not.toContain('type="checkbox"');
    expect(html).toContain("Retirer ma demande"); // son seul geste : retirer SA demande
    expect(html).toContain('id="espace-exploitation"');
    for (const absent of ['id="espace-rh"', 'id="espace-stock"', "Employe Marque", "Marque Stock", "Farine Marquee"]) expect(html, absent).not.toContain(absent);
  });

  it("Exploitation, Direction (contre-épreuve) : les deux demandes, les boutons, et — même page — la RH et le Stock", async () => {
    en("DIR");
    const html = await page(PAGE_EXPLOITATION);
    expect(html).toContain("Compta Un");
    expect(html).toContain("Compta Deux");
    expect(html).toContain("Approuver");
    expect(html).toContain("Refuser");
    expect(html).toContain('type="checkbox"');
    for (const marque of ["Employe Marque Un", "Marque Stock Un", "Marque Stock Deux"]) expect(html, marque).toContain(marque);
  });

  it("la MÊME page à trois adresses : la Direction y lit les mêmes rubriques et le même chiffre, quelle que soit la coquille", async () => {
    en("DIR");
    const pages = [await page(PAGE_RH), await page(PAGE_STOCK), await page(PAGE_EXPLOITATION)];
    expect(pages.map(enAttente)).toEqual([13, 13, 13]);
    const rubriques = (html: string) => [...html.matchAll(/<(?:section|details) id="([^"]+)"/g)].map((m) => m[1]);
    expect(rubriques(pages[1])).toEqual(rubriques(pages[0]));
    expect(rubriques(pages[2])).toEqual(rubriques(pages[0]));
    expect(rubriques(pages[0])).toEqual(expect.arrayContaining(["espace-rh", "conges", "modifications-fiches", "bulletins-a-payer", "espace-stock", "bons-de-commande", "demandes", "espace-exploitation", "demandes-ratios"]));
    // Un titre unique et l'ancre « #demandes-ratios » une seule fois (la rubrique la porte, plus le composant).
    for (const html of pages) {
      expect(html.match(/<h1\b/g)).toHaveLength(1);
      expect(html.match(/id="demandes-ratios"/g)).toHaveLength(1);
    }
  });

  it("les rubriques se replient (espace puis nature), ouvertes au départ ; un espace sans rien à valider n'est pas affiché", async () => {
    en("CPT");
    const html = await page(PAGE_EXPLOITATION);
    expect(html).toMatch(/<details id="espace-exploitation" open/);
    expect(html).toMatch(/<details id="demandes-ratios" open/);
    expect(html).toContain("<summary");
  });

  it("Plan de comptes : la section des demandes a disparu, un lien « → À valider » la remplace (ancre conservée)", async () => {
    for (const c of ["DIR", "CPT"] as Compte[]) {
      en(c);
      const html = await page(PAGE_PLAN);
      expect(html, c).toContain('href="/exploitation/a-valider"');
      expect(html, c).toContain('id="demandes-ratios"');
      expect(html, c).toContain("→ À valider");
      expect(html, c).not.toMatch(/Approuver|Refuser/);
      expect(html, c).not.toContain("Modifications de ratios");
    }
  });
});

describe("refus serveur — chaque action de décision, appelée directement, est refusée et n'écrit rien", () => {
  type Decision = { nom: string; appeler: () => Promise<unknown>; refusesA: Compte[] };
  const TOUS: Compte[] = ["MGR", "VIEW", "STK", "CPT", "EMP", "EMPS"];
  // Le Responsable RH garde deux gestes qui ne sont pas des validations (règles de la paie et du planning,
  // inchangées par ce lot) : marquer payé un bulletin que la Direction a validé, acter un shift.
  const SAUF_MGR: Compte[] = ["VIEW", "STK", "CPT", "EMP", "EMPS"];
  const v = async () => Object.fromEntries((await prisma.demandeValidationStock.findMany({ select: { id: true, updatedAt: true } })).map((x) => [x.id, x.updatedAt.toISOString()]));
  const DECISIONS: Decision[] = [
    { nom: "fiches : approuver", appeler: () => FICHES.approuverModifsFiche([S.modifMgr2]), refusesA: TOUS },
    { nom: "fiches : refuser", appeler: () => FICHES.refuserModifsFiche([S.modifMgr2, S.creationMgr2], "non"), refusesA: TOUS },
    { nom: "congé : approuver", appeler: () => CONGES.approuverConge(S.conge), refusesA: TOUS },
    { nom: "congé : refuser", appeler: () => CONGES.refuserConge(S.conge, "non"), refusesA: TOUS },
    { nom: "congés : approuver en lot", appeler: () => CONGES.approuverCongesEnLot([S.conge]), refusesA: TOUS },
    { nom: "congés : refuser en lot", appeler: () => CONGES.refuserCongesEnLot([S.conge], "non"), refusesA: TOUS },
    { nom: "acompte : approuver", appeler: () => REMU.approuverAcompte(S.acompte), refusesA: TOUS },
    { nom: "acompte : refuser", appeler: () => REMU.refuserAcompte(S.acompte), refusesA: TOUS },
    { nom: "acomptes : approuver en lot", appeler: () => REMU.approuverAcomptesEnLot([S.acompte]), refusesA: TOUS },
    { nom: "acomptes : refuser en lot", appeler: () => REMU.refuserAcomptesEnLot([S.acompte]), refusesA: TOUS },
    { nom: "attestations : délivrer", appeler: () => ATT.delivrerAttestations([S.attestation]), refusesA: TOUS },
    { nom: "attestations : refuser", appeler: () => ATT.refuserAttestations([S.attestation], "non"), refusesA: TOUS },
    { nom: "bulletins : valider en lot", appeler: () => PAIE.changerStatutEnLot([S.ligneAValider], "VALIDE", null, {}), refusesA: TOUS },
    { nom: "bulletins : marquer payé (Direction et RH)", appeler: () => PAIE.changerStatutEnLot([S.ligneAPayer], "PAYE", "ESPECES", {}), refusesA: SAUF_MGR },
    { nom: "shifts : approuver des changements (Direction et RH)", appeler: () => SHIFTS.approuverChangementsEnLot(["inconnu"]), refusesA: SAUF_MGR },
    { nom: "shifts : refuser des échanges (Direction et RH)", appeler: () => SHIFTS.refuserEchangesEnLot(["inconnu"]), refusesA: SAUF_MGR },
    { nom: "stock : valider des demandes", appeler: async () => STOCK.validerDemandes([S.demandeStk2], {}, await v()), refusesA: TOUS },
    { nom: "stock : refuser des demandes", appeler: async () => STOCK.refuserDemandes([S.demandeStk2], "non, pas ça", await v()), refusesA: TOUS },
    { nom: "stock : valider un bon de commande", appeler: () => BC.validerBonCommande(S.bon, new FormData()), refusesA: TOUS },
    { nom: "ratios : approuver", appeler: () => RATIOS.approuverRatios([S.ratiosCpt2]), refusesA: TOUS },
    { nom: "ratios : refuser", appeler: () => RATIOS.refuserRatios([S.ratiosCpt2], "non"), refusesA: TOUS },
  ];

  it.each(DECISIONS.flatMap((d) => d.refusesA.map((c) => ({ ...d, compte: c }))))("$nom — refusé à $compte", async ({ appeler, compte }) => {
    en(compte);
    const refus = await tenter(appeler);
    expect(refus, "l'action a réussi pour un compte qui n'est pas la Direction").not.toBeNull();
  });

  it("rien n'a été écrit : toutes les demandes sont encore en attente, le bon en brouillon, le bulletin à valider inchangé", async () => {
    expect((await prisma.demandeModifFiche.findUniqueOrThrow({ where: { id: S.modifMgr2 } })).statut).toBe("EN_ATTENTE");
    expect((await prisma.demandeCreationFiche.findUniqueOrThrow({ where: { id: S.creationMgr2 } })).statut).toBe("EN_ATTENTE");
    expect((await prisma.leaveRequest.findUniqueOrThrow({ where: { id: S.conge } })).statut).toBe("EN_ATTENTE");
    expect((await prisma.acompteSalaire.findUniqueOrThrow({ where: { id: S.acompte } })).statut).toBe("EN_ATTENTE");
    expect((await prisma.attestation.findUniqueOrThrow({ where: { id: S.attestation } })).statut).toBe("DEMANDEE");
    expect((await prisma.payrollLine.findUniqueOrThrow({ where: { id: S.ligneAValider } })).statutPaiement).toBe("PAS_VALIDE");
    expect((await prisma.payrollLine.findUniqueOrThrow({ where: { id: S.ligneAPayer } })).statutPaiement).toBe("VALIDE");
    expect((await prisma.demandeValidationStock.findUniqueOrThrow({ where: { id: S.demandeStk2 } })).statut).toBe("EN_ATTENTE");
    expect((await prisma.bonDeCommande.findUniqueOrThrow({ where: { id: S.bon } })).statut).toBe("BROUILLON");
    expect((await prisma.demandeRatiosRubrique.findUniqueOrThrow({ where: { id: S.ratiosCpt2 } })).statut).toBe("EN_ATTENTE");
  });

  it("et la Direction, elle, peut décider (contre-épreuve : le refus ci-dessus tient au rôle, pas à un jeu de données cassé)", async () => {
    en("DIR");
    expect(await tenter(() => RATIOS.approuverRatios([S.ratiosCpt2]))).toBeNull();
    expect((await prisma.demandeRatiosRubrique.findUniqueOrThrow({ where: { id: S.ratiosCpt2 } })).statut).toBe("VALIDEE");
    expect(await tenter(() => BC.validerBonCommande(S.bon, new FormData()))).toBeNull();
    expect((await prisma.bonDeCommande.findUniqueOrThrow({ where: { id: S.bon } })).statut).toBe("VALIDE");
  });
});

describe("retour d'un refus de paie : liste FERMÉE, la page « À valider » d'où l'on vient", () => {
  // Une date de versement future est refusée AVANT toute écriture : le refus revient à l'adresse du formulaire — si elle est permise.
  const refus = async (retour: string | null) => {
    en("DIR");
    const f = new FormData();
    f.set("versStatut", "PAYE");
    f.set("dateVersement", "2099-01-01");
    if (retour !== null) f.set("retour", retour);
    try { await PAIE.changerStatutPaie(S.ligneAPayer, f); return "pas de redirection"; } catch (e) { return (e as { url?: string }).url ?? String(e); }
  };

  it.each(["/a-valider", "/stock/a-valider", "/exploitation/a-valider"])("le refus revient à %s (la coquille d'où part le geste)", async (adresse) => {
    expect(await refus(adresse)).toMatch(new RegExp(`^${adresse}\\?erreur=`));
  });

  it("toute autre adresse (liste fermée) retombe sur Paie : jamais une adresse venue du formulaire", async () => {
    for (const mauvaise of ["https://exemple.test/a-valider", "//exemple.test", "/employes", "/a-valider/../paie", "/stock/a-valider?x=1", "", null]) {
      expect(await refus(mauvaise), String(mauvaise)).toMatch(/^\/paie\?erreur=/);
    }
  });
});

describe("sélecteur d'espace — « N à valider » sur les cartes de la Direction, les mêmes chiffres que les badges", () => {
  // Les décisions ci-dessus ont vidé une demande de ratios et le bon de commande : on relit les chiffres de la base.
  it("Direction : une mention par espace de bureau, égale au badge de cet espace", async () => {
    CHARGEURS.reinitialiserCacheAValider();
    en("DIR");
    const dir = { id: ids.DIR, role: "ADMIN" };
    const attendu = {
      rh: (await CHARGEURS.chargerAValiderRH(dir)).total,
      stock: (await CHARGEURS.chargerAValiderStock(dir)).total,
      exploitation: await CHARGEURS.chargerAValiderExploitation(dir),
    };
    // Les cartes montrent le détail PAR ESPACE ; la pastille des menus en est la somme.
    expect(await CHARGEURS.chargerTotalAValider(dir)).toBe(attendu.rh + attendu.stock + attendu.exploitation);
    expect(attendu).toEqual({ rh: 8, stock: 2, exploitation: 1 });
    const html = renderToStaticMarkup(await PAGE_CHOIX());
    const mentions = [...html.matchAll(/(\d+|Rien) à valider/g)].map((m) => m[0]);
    expect(mentions).toEqual([`${attendu.rh} à valider`, `${attendu.stock} à valider`, `${attendu.exploitation} à valider`]); // ordre des cartes : RH, Stock, Exploitation
    expect(await CHARGEURS.chargerAttenteDirection(dir)).toEqual(attendu);
    expect(await CHARGEURS.chargerAttenteDirection(dir, "rh")).toEqual({ ...attendu, rh: 0 });
  });

  it("un compte qui n'est pas la Direction et qui a deux espaces (magasinier + espace salarié) : aucune mention", async () => {
    en("STK", S.emp.e1);
    const html = renderToStaticMarkup(await PAGE_CHOIX());
    expect(html).toContain("Stock &amp; Achats");
    expect(html).toContain("Mon espace salarié");
    expect(html).not.toMatch(/à valider/);
  });
});

// Les deux gestes historiques du Responsable RH sont des GESTES D'ÉCRAN, pas seulement des actions serveur :
// les notifications « changement de shift » le mènent ici (`lien: "/a-valider"`), c'est le seul écran où
// il peut acter un shift. Il doit donc les voir, les compter et pouvoir les décider ; la consultation non.
describe("Responsable RH — le geste « acter un shift » reste sur l'écran (régression corrigée)", () => {
  it("il voit, compte et peut décider une demande de changement de shift ; la consultation et la Direction (contre-épreuve) aussi bien servies", async () => {
    const [sA, sB] = await Promise.all([
      prisma.shift.create({ data: { nom: "Matin marqué", heureDebut: "07:00", heureFin: "15:00" } }),
      prisma.shift.create({ data: { nom: "Soir marqué", heureDebut: "15:00", heureFin: "23:00" } }),
    ]);
    await prisma.demandeChangementShift.create({ data: { employeeId: S.emp.e2, date: new Date("2026-11-10"), shiftActuelId: sA.id, shiftDemandeId: sB.id, motif: "Motif de shift marqué" } });
    CHARGEURS.reinitialiserCacheAValider();
    expect(await pastille("MGR")).toBe(3); // 2 d'avant + le changement de shift
    expect(await pastille("VIEW")).toBe(0);

    en("MGR");
    const htmlMgr = await page(PAGE_RH);
    expect(htmlMgr).toContain("Motif de shift marqué");
    expect(htmlMgr).toContain("Approuver"); // le geste est là
    expect(enAttente(htmlMgr)).toBe(3);
    // …sans révéler le reste de la file des autres.
    for (const marque of ["Employe Marque Trois", "Employe Marque Quatre", "Employe Marque Cinq"]) expect(htmlMgr, marque).not.toContain(marque);

    en("VIEW");
    const htmlView = await page(PAGE_RH);
    expect(htmlView).not.toContain("Motif de shift marqué");
    expect(aDesBoutonsDeDecision(htmlView)).toBe(false);

    en("DIR");
    expect(await page(PAGE_RH)).toContain("Motif de shift marqué");
  });
});

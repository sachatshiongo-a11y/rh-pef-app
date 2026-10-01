import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient, Role } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// SEULE LA DIRECTION SUPPRIME (règle de Sacha, 2026-10-01) — preuve par les VRAIES actions serveur,
// appelées directement comme le ferait un compte qui contourne l'écran (aucun bouton, aucun layout) :
// pour chaque nature de suppression, chaque compte qui n'est pas la Direction est refusé, rien ne
// disparaît ; puis la Direction supprime comme avant. Les rôles d'accès (`requireRole`,
// `requireModule`) sont les VRAIS prédicats (lib/espaces) : seule la session est simulée.

const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
const A = vi.hoisted(() => ({ user: { id: "", email: "", nom: "", role: "ADMIN" as string, accesStock: false, employeeId: null as string | null } }));
const S = vi.hoisted(() => ({ supprimerPhoto: vi.fn(async (..._a: unknown[]) => {}) }));

vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));
vi.mock("@/lib/auth", async () => {
  const esp = await import("@/lib/espaces");
  return {
    verifySession: async () => A.user,
    requireRole: (u: { role: string }, roles: string[]) => { if (!roles.includes(u.role)) throw new Error("Accès refusé : rôle insuffisant."); },
    requireModule: (u: { role: Role; accesStock?: boolean; employeeId?: string | null }, espace: string) => {
      const ok = espace === "rh" ? esp.estRH(u.role) : espace === "stock" ? esp.estStock(u) : espace === "exploitation" ? esp.estExploitation(u) : esp.estSalarie(u);
      if (!ok) throw new Error("Accès refusé : module non autorisé.");
    },
    invaliderProfil: () => {},
  };
});
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
// Une redirection Next porte un `digest` NEXT_REDIRECT : `formulaireLisible` la laisse passer ; le
// test lit l'URL (un `?erreur=` est un refus, toute autre destination un succès).
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw Object.assign(new Error(`REDIRECT ${url}`), { digest: `NEXT_REDIRECT;${url}`, url }); },
  notFound: () => { throw Object.assign(new Error("NOT_FOUND"), { digest: "NEXT_NOT_FOUND" }); },
}));
vi.mock("@/lib/push", () => ({ envoyerPush: async () => {} }));
vi.mock("@/lib/fiches/photo-storage", async (orig) => ({
  ...(await orig<typeof import("@/lib/fiches/photo-storage")>()),
  identifiantsSupabase: () => ({ base: "https://exemple.test", key: "cle-de-test" }),
  supprimerPhoto: S.supprimerPhoto,
}));

const RH = await import("./(app)/employes/actions");
const PRES = await import("./(app)/presences/actions");
const CONGES = await import("./(app)/conges/actions");
const REMU = await import("./(app)/paie/remuneration-actions");
const PLAN = await import("./(app)/planning/actions");
const POSTES = await import("./(app)/fiches-poste/actions");
const PARAM = await import("./(app)/parametres/actions");
const TYPES = await import("./(app)/parametres/typeconge-actions");
const CAT = await import("./(stock)/stock/catalogue/actions");
const FICHES = await import("./(stock)/stock/fiches/actions");
const PHOTO = await import("./(stock)/stock/fiches/photo-actions");
const FOUR = await import("./(stock)/stock/fournisseurs/actions");
const FAC = await import("./(stock)/stock/factures/actions");
const MVT = await import("./(stock)/stock/mouvements/actions");
const BC = await import("./(stock)/stock/commandes/actions");
const LEG = await import("./(stock)/stock/legumes/actions");
const RESTO = await import("./(stock)/stock/restaurant/actions");
const JOURNAL = await import("./(exploitation)/exploitation/journal/actions");

let prisma: PrismaClient;
let fermer: () => Promise<void>;

// Tous les comptes qui ne sont pas la Direction — chacun atteint au moins un espace.
const COMPTES = {
  ADMIN: { role: "ADMIN", accesStock: false },
  MANAGER: { role: "MANAGER", accesStock: false },
  VIEWER: { role: "VIEWER", accesStock: false },
  STOCK: { role: "STOCK", accesStock: false },
  EMPLOYE_STOCK: { role: "EMPLOYE", accesStock: true },
  COMPTA: { role: "COMPTA", accesStock: false },
  SALARIE: { role: "EMPLOYE", accesStock: false },
} as const;
type Compte = keyof typeof COMPTES;
const NON_DIRECTION = (Object.keys(COMPTES) as Compte[]).filter((c) => c !== "ADMIN");
const ids: Partial<Record<Compte, string>> = {};
let empId = "";

function en(c: Compte) {
  const k = COMPTES[c];
  A.user = { id: ids[c]!, email: `${c}@pef.test`, nom: c, role: k.role, accesStock: k.accesStock, employeeId: c === "SALARIE" ? empId : null };
}

/** Appelle l'action ; renvoie le message de refus (valeur `{ erreur }`, `?erreur=` de page, ou erreur levée), ou null. */
async function tenter(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    const r = await fn();
    if (typeof r === "object" && r !== null && "erreur" in r) return String((r as { erreur: unknown }).erreur);
    return null;
  } catch (e) {
    const url = (e as { url?: string }).url;
    if (url !== undefined) {
      const m = /[?&]erreur=([^&]*)/.exec(url);
      return m ? decodeURIComponent(m[1]) : null;
    }
    return e instanceof Error ? e.message : String(e);
  }
}

const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.append(k, v); return f; };
let seq = 0;
const unique = (p: string) => `${p}-${++seq}`;

async function creerEmploye() {
  const e = await prisma.employee.create({
    data: {
      matricule: unique("SD"), nom: unique("Salarié"), sexe: "F", etatCivil: "Célibataire", poste: "Commis", secteur: "Cuisine",
      categorie: "BRIGADE", salaireMensuel: 300, dateEmbauche: new Date("2025-01-01"), contrat: "CDI",
    },
  });
  return e.id;
}

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  empId = await creerEmploye();
  for (const c of Object.keys(COMPTES) as Compte[]) {
    const u = await prisma.user.create({ data: { email: `${c.toLowerCase()}@pef.test`, nom: c, role: COMPTES[c].role, accesStock: COMPTES[c].accesStock, employeeId: c === "SALARIE" ? empId : null } });
    ids[c] = u.id;
  }
}, 120_000);
afterAll(async () => { await fermer?.(); });

type Cas = {
  /** Ce qui est supprimé. */
  nature: string;
  /** Crée l'enregistrement, renvoie sa clé. */
  creer: () => Promise<string>;
  /** L'action serveur, telle que l'écran l'appelle. */
  supprimer: (id: string) => Promise<unknown>;
  /** L'enregistrement est-il encore là ? */
  existe: (id: string) => Promise<boolean>;
};

const CAS: Cas[] = [
  // ── RH ─────────────────────────────────────────────────────────────────────────────────────
  {
    nature: "membre de la famille",
    creer: async () => (await prisma.membreFamille.create({ data: { employeeId: empId, lien: "ENFANT", nom: unique("Enfant") } })).id,
    supprimer: (id) => RH.supprimerMembreFamille(id),
    existe: async (id) => !!(await prisma.membreFamille.findUnique({ where: { id } })),
  },
  {
    nature: "conjoint remplacé par un autre (le remplacer l'efface)",
    creer: async () => {
      const e = await creerEmploye();
      await prisma.membreFamille.create({ data: { employeeId: e, lien: "CONJOINT", nom: "Conjoint d'origine" } });
      return e;
    },
    supprimer: (e) => RH.ajouterMembreFamille(e, fd({ lien: "CONJOINT", nom: unique("Nouveau conjoint") })),
    existe: async (e) => !!(await prisma.membreFamille.findFirst({ where: { employeeId: e, nom: "Conjoint d'origine" } })),
  },
  {
    nature: "présence saisie (case vidée)",
    creer: async () => { await prisma.attendance.create({ data: { employeeId: empId, date: new Date("2026-03-02"), code: "P" } }); return "2026-03-02"; },
    supprimer: (date) => PRES.saisirPresence(empId, date, ""),
    existe: async (date) => !!(await prisma.attendance.findFirst({ where: { employeeId: empId, date: new Date(date) } })),
  },
  {
    nature: "congé",
    creer: async () => (await prisma.leaveRequest.create({ data: { employeeId: empId, type: "Congé annuel", dateDebut: new Date("2026-04-06"), dateFin: new Date("2026-04-07"), nbJours: 2 } })).id,
    supprimer: (id) => CONGES.supprimerConge(id),
    existe: async (id) => !!(await prisma.leaveRequest.findUnique({ where: { id } })),
  },
  {
    nature: "acompte",
    creer: async () => (await prisma.acompteSalaire.create({ data: { employeeId: empId, montantUSD: 20, mois: 1, annee: 2026 } })).id,
    supprimer: (id) => REMU.supprimerAcompte(id),
    existe: async (id) => !!(await prisma.acompteSalaire.findUnique({ where: { id } })),
  },
  {
    nature: "prime",
    creer: async () => (await prisma.prime.create({ data: { employeeId: empId, nom: "Prime", montantUSD: 10, mois: 1, annee: 2026 } })).id,
    supprimer: (id) => REMU.supprimerPrime(id),
    existe: async (id) => !!(await prisma.prime.findUnique({ where: { id } })),
  },
  {
    nature: "frais médical",
    creer: async () => (await prisma.fraisMedical.create({ data: { employeeId: empId, montantUSD: 15, mois: 1, annee: 2026 } })).id,
    supprimer: (id) => REMU.supprimerFraisMedical(id),
    existe: async (id) => !!(await prisma.fraisMedical.findUnique({ where: { id } })),
  },
  {
    nature: "avantage en nature",
    creer: async () => (await prisma.avantageNature.create({ data: { employeeId: empId, nature: "Logement", montantUSD: 50, mois: 1, annee: 2026 } })).id,
    supprimer: (id) => REMU.supprimerAvantageNature(id),
    existe: async (id) => !!(await prisma.avantageNature.findUnique({ where: { id } })),
  },
  {
    nature: "shift",
    creer: async () => (await prisma.shift.create({ data: { nom: unique("Shift") } })).id,
    supprimer: (id) => PLAN.supprimerShift(id),
    existe: async (id) => !!(await prisma.shift.findUnique({ where: { id } })),
  },
  {
    nature: "shift d'un poste",
    creer: async () => {
      const s = await prisma.shift.create({ data: { nom: unique("Shift") } });
      return (await prisma.shiftPoste.create({ data: { poste: "Commis", shiftId: s.id } })).id;
    },
    supprimer: (id) => PLAN.supprimerShiftPoste(id),
    existe: async (id) => !!(await prisma.shiftPoste.findUnique({ where: { id } })),
  },
  {
    nature: "polyvalence",
    creer: async () => (await prisma.polyvalencePoste.create({ data: { posteSource: unique("Poste"), posteCible: "Commis" } })).id,
    supprimer: (id) => PLAN.supprimerPolyvalence(id),
    existe: async (id) => !!(await prisma.polyvalencePoste.findUnique({ where: { id } })),
  },
  {
    nature: "fiche de poste",
    creer: async () => (await prisma.fichePoste.create({ data: { poste: unique("Plongeur") } })).poste,
    supprimer: (poste) => POSTES.supprimerFichePoste(poste),
    existe: async (poste) => !!(await prisma.fichePoste.findUnique({ where: { poste } })),
  },
  {
    nature: "poste (fiche, besoins, polyvalences)",
    creer: async () => (await prisma.fichePoste.create({ data: { poste: unique("Barman") } })).poste,
    supprimer: (poste) => POSTES.supprimerPoste(poste),
    existe: async (poste) => !!(await prisma.fichePoste.findUnique({ where: { poste } })),
  },
  {
    nature: "jour férié",
    creer: async () => String((await prisma.jourFerie.create({ data: { date: new Date(`2027-0${(seq % 8) + 1}-1${seq % 9}`), designation: unique("Férié"), annee: 2027 } })).id),
    supprimer: (id) => PARAM.supprimerJourFerie(Number(id)),
    existe: async (id) => !!(await prisma.jourFerie.findUnique({ where: { id: Number(id) } })),
  },
  {
    nature: "type de congé",
    creer: async () => (await prisma.typeConge.create({ data: { nom: unique("Type") } })).id,
    supprimer: (id) => TYPES.supprimerTypeConge(id),
    existe: async (id) => !!(await prisma.typeConge.findUnique({ where: { id } })),
  },
  // ── Stock ──────────────────────────────────────────────────────────────────────────────────
  {
    nature: "article",
    creer: async () => (await prisma.articleStock.create({ data: { designation: unique("Riz"), domaine: "NOURRITURE" } })).id,
    supprimer: (id) => CAT.supprimerArticle(id),
    existe: async (id) => !!(await prisma.articleStock.findUnique({ where: { id } })),
  },
  {
    nature: "article fusionné (le doublon est supprimé)",
    creer: async () => {
      const garde = await prisma.articleStock.create({ data: { designation: unique("Crème"), domaine: "NOURRITURE" } });
      const doublon = await prisma.articleStock.create({ data: { designation: unique("Cooking cream"), domaine: "NOURRITURE" } });
      return `${garde.id}|${doublon.id}`;
    },
    supprimer: (k) => { const [g, d] = k.split("|"); return CAT.fusionnerArticles([g, d], g); },
    existe: async (k) => !!(await prisma.articleStock.findUnique({ where: { id: k.split("|")[1] } })),
  },
  {
    nature: "fiche technique",
    creer: async () => (await prisma.ficheTechnique.create({ data: { nom: unique("Carbonara") } })).id,
    supprimer: (id) => FICHES.supprimerFiches([id]),
    existe: async (id) => !!(await prisma.ficheTechnique.findUnique({ where: { id } })),
  },
  {
    nature: "ingrédient d'une fiche (« Retirer »)",
    creer: async () => creerIngredient(),
    supprimer: (k) => { const [f, i] = k.split("|"); return FICHES.supprimerIngredients(f, [i]); },
    existe: async (k) => !!(await prisma.ingredientFiche.findUnique({ where: { id: k.split("|")[1] } })),
  },
  {
    nature: "ingrédient d'une fiche (lot amputé envoyé à « Enregistrer »)",
    creer: async () => creerIngredient(),
    supprimer: (k) => FICHES.remplacerIngredients(k.split("|")[0], []),
    existe: async (k) => !!(await prisma.ingredientFiche.findUnique({ where: { id: k.split("|")[1] } })),
  },
  {
    nature: "photo d'une fiche technique",
    creer: async () => (await prisma.ficheTechnique.create({ data: { nom: unique("Tiramisu"), photoUrl: "/fichiers/fiches/x.png" } })).id,
    supprimer: (id) => PHOTO.supprimerPhotoFiche(id),
    existe: async (id) => !!(await prisma.ficheTechnique.findUnique({ where: { id } }))?.photoUrl,
  },
  {
    nature: "fournisseur",
    creer: async () => (await prisma.fournisseur.create({ data: { nom: unique("Fournisseur") } })).id,
    supprimer: (id) => FOUR.supprimerFournisseur(id),
    existe: async (id) => !!(await prisma.fournisseur.findUnique({ where: { id } })),
  },
  {
    nature: "fournisseur fusionné (la source est supprimée)",
    creer: async () => {
      const s = await prisma.fournisseur.create({ data: { nom: unique("Source") } });
      const c = await prisma.fournisseur.create({ data: { nom: unique("Cible") } });
      return `${s.id}|${c.id}`;
    },
    supprimer: (k) => { const [s, c] = k.split("|"); return FOUR.fusionnerFournisseurs(s, c); },
    existe: async (k) => !!(await prisma.fournisseur.findUnique({ where: { id: k.split("|")[0] } })),
  },
  {
    nature: "facture",
    creer: async () => creerFacture(),
    supprimer: (id) => FAC.supprimerFacture(id),
    existe: async (id) => !!(await prisma.factureFournisseur.findUnique({ where: { id } })),
  },
  {
    nature: "factures en lot",
    creer: async () => creerFacture(),
    supprimer: (id) => FAC.supprimerFacturesEnLot([id]),
    existe: async (id) => !!(await prisma.factureFournisseur.findUnique({ where: { id } })),
  },
  {
    nature: "mouvement de stock",
    creer: async () => creerMouvement(),
    supprimer: (id) => MVT.supprimerMouvement(id),
    existe: async (id) => !!(await prisma.mouvementStock.findUnique({ where: { id } })),
  },
  {
    nature: "mouvements en lot",
    creer: async () => creerMouvement(),
    supprimer: (id) => MVT.supprimerMouvementsEnLot([id]),
    existe: async (id) => !!(await prisma.mouvementStock.findUnique({ where: { id } })),
  },
  {
    nature: "bon de commande",
    creer: async () => creerBC(),
    supprimer: (id) => BC.supprimerBonCommande(id, new FormData()),
    existe: async (id) => !!(await prisma.bonDeCommande.findUnique({ where: { id } })),
  },
  {
    nature: "bons de commande en lot",
    creer: async () => creerBC(),
    supprimer: (id) => BC.supprimerBonsEnLot([id]),
    existe: async (id) => !!(await prisma.bonDeCommande.findUnique({ where: { id } })),
  },
  {
    nature: "achat de légumes",
    creer: async () => (await prisma.achatLegume.create({ data: { date: new Date("2026-09-15"), legume: "Tomate", quantite: 3 } })).id,
    supprimer: (id) => LEG.supprimerAchatLegume(id),
    existe: async (id) => !!(await prisma.achatLegume.findUnique({ where: { id } })),
  },
  {
    nature: "article du restaurant",
    creer: async () => (await prisma.articleResto.create({ data: { espace: "CUISINE", designation: unique("Sel") } })).id,
    supprimer: (id) => RESTO.supprimerArticleResto(id),
    existe: async (id) => !!(await prisma.articleResto.findUnique({ where: { id } })),
  },
  // ── Exploitation ───────────────────────────────────────────────────────────────────────────
  {
    nature: "écriture du journal de caisse",
    creer: async () => creerEcriture(),
    supprimer: (id) => JOURNAL.supprimerEcritures([Number(id)]),
    existe: async (id) => !!(await prisma.ecritureCaisse.findUnique({ where: { id: Number(id) } })),
  },
];

async function creerIngredient() {
  const a = await prisma.articleStock.create({ data: { designation: unique("Lardons"), domaine: "NOURRITURE" } });
  const f = await prisma.ficheTechnique.create({ data: { nom: unique("Pâtes") } });
  const i = await prisma.ingredientFiche.create({ data: { ficheId: f.id, articleId: a.id, unite: "g", quantite: 80 } });
  return `${f.id}|${i.id}`;
}
async function creerFacture() {
  return (await prisma.factureFournisseur.create({ data: { fournisseurNom: "Grossiste", montantUSD: 100, mois: 9, annee: 2026 } })).id;
}
async function creerMouvement() {
  const a = await prisma.articleStock.create({ data: { designation: unique("Farine"), domaine: "NOURRITURE" } });
  return (await prisma.mouvementStock.create({ data: { articleId: a.id, type: "ENTREE", quantite: 5, date: new Date("2026-09-15") } })).id;
}
async function creerBC() {
  const n = ++seq;
  return (await prisma.bonDeCommande.create({ data: { numero: `${n}/PEF/SEPT/26`, sequence: n, annee: 2026, mois: 9 } })).id;
}
let comptaPret: { rubriqueId: number; categorieId: number; compteId: number } | null = null;
async function creerEcriture() {
  if (!comptaPret) {
    const r = await prisma.rubrique.create({ data: { nom: "Charges diverses", sens: "DEPENSE" } });
    const c = await prisma.categorie.create({ data: { nom: "Divers", rubriqueId: r.id } });
    const k = await prisma.compteTresorerie.create({ data: { nom: "Caisse" } });
    comptaPret = { rubriqueId: r.id, categorieId: c.id, compteId: k.id };
  }
  const e = await prisma.ecritureCaisse.create({
    data: { date: new Date("2026-09-15"), sens: "DEPENSE", ...comptaPret, denomination: unique("Achat"), montantOrigine: 10, devise: "USD", tauxChangeUtilise: 1, montantUSD: 10 },
  });
  return String(e.id);
}

describe("seule la Direction supprime — refus sans effet pour tout autre compte, la Direction supprime comme avant", () => {
  it.each(CAS.map((c) => [c.nature, c] as const))("%s", async (_n, cas) => {
    const id = await cas.creer();
    for (const compte of NON_DIRECTION) {
      en(compte);
      const refus = await tenter(() => cas.supprimer(id));
      expect(refus, `${compte} a pu supprimer : ${cas.nature}`).not.toBeNull();
      expect(await cas.existe(id), `${compte} : « ${cas.nature} » a disparu malgré le refus`).toBe(true);
    }
    en("ADMIN");
    expect(await tenter(() => cas.supprimer(id))).toBeNull();
    expect(await cas.existe(id), `la Direction n'a pas pu supprimer : ${cas.nature}`).toBe(false);
  });

  it("le refus nomme la Direction (et ne ressemble pas à une panne) pour les gardes ajoutées", async () => {
    en("STOCK");
    expect(await tenter(async () => FICHES.supprimerFiches([await (async () => (await prisma.ficheTechnique.create({ data: { nom: unique("Pizza") } })).id)()]))).toMatch(/réservé à la Direction/);
    en("COMPTA");
    expect(await tenter(async () => JOURNAL.supprimerEcritures([Number(await creerEcriture())]))).toMatch(/réservé à la Direction/);
    en("MANAGER");
    const m = await prisma.membreFamille.create({ data: { employeeId: empId, lien: "ENFANT", nom: unique("Enfant") } });
    expect(await tenter(() => RH.supprimerMembreFamille(m.id))).toMatch(/réservé à la Direction/);
  });

  it("photo retirée : le fichier du stockage n'est touché que pour la Direction", async () => {
    const f = await prisma.ficheTechnique.create({ data: { nom: unique("Panna cotta"), photoUrl: "/fichiers/fiches/y.png" } });
    S.supprimerPhoto.mockClear();
    en("STOCK");
    await tenter(() => PHOTO.supprimerPhotoFiche(f.id));
    expect(S.supprimerPhoto).not.toHaveBeenCalled();
    en("ADMIN");
    await tenter(() => PHOTO.supprimerPhotoFiche(f.id));
    expect(S.supprimerPhoto).toHaveBeenCalledTimes(1);
  });
});

describe("présences : vider une case saisie est réservé à la Direction, le reste de la grille ne change pas", () => {
  it("lot : une seule case à vider suffit à refuser TOUT le lot, rien n'est écrit", async () => {
    const e = await creerEmploye();
    await prisma.attendance.create({ data: { employeeId: e, date: new Date("2026-05-04"), code: "P" } });
    en("MANAGER");
    const r = await PRES.saisirPresencesEnLot([
      { employeeId: e, date: "2026-05-05", code: "A" }, // écriture légitime…
      { employeeId: e, date: "2026-05-04", code: "" }, //  …mais le lot vide une présence saisie
    ]);
    expect(r.erreur).toMatch(/réservé à la Direction/);
    expect(await prisma.attendance.count({ where: { employeeId: e } })).toBe(1);
    expect((await prisma.attendance.findFirstOrThrow({ where: { employeeId: e } })).code).toBe("P");
  });

  it("le responsable REMPLACE un code (P → O) et vide une case déjà vide sans refus", async () => {
    const e = await creerEmploye();
    await prisma.attendance.create({ data: { employeeId: e, date: new Date("2026-05-11"), code: "P" } });
    en("MANAGER");
    expect(await PRES.saisirPresence(e, "2026-05-11", "O")).toEqual({});
    expect((await prisma.attendance.findFirstOrThrow({ where: { employeeId: e } })).code).toBe("O");
    expect(await PRES.saisirPresence(e, "2026-05-12", "")).toEqual({});
    const lot = await PRES.saisirPresencesEnLot([{ employeeId: e, date: "2026-05-13", code: "" }, { employeeId: e, date: "2026-05-14", code: "A" }]);
    expect(lot.erreur).toBeUndefined();
    expect(await prisma.attendance.count({ where: { employeeId: e } })).toBe(2);
  });

  it("la Direction vide une case saisie, à l'unité comme en lot", async () => {
    const e = await creerEmploye();
    await prisma.attendance.createMany({ data: [{ employeeId: e, date: new Date("2026-05-18"), code: "P" }, { employeeId: e, date: new Date("2026-05-19"), code: "P" }] });
    en("ADMIN");
    expect(await PRES.saisirPresence(e, "2026-05-18", "")).toEqual({});
    expect((await PRES.saisirPresencesEnLot([{ employeeId: e, date: "2026-05-19", code: "" }])).erreur).toBeUndefined();
    expect(await prisma.attendance.count({ where: { employeeId: e } })).toBe(0);
  });
});

describe("ce qui reste ouvert au responsable (modifications, pas des suppressions)", () => {
  it("ajouter un premier conjoint, ou un enfant : permis hors Direction", async () => {
    const e = await creerEmploye();
    en("MANAGER");
    expect(await tenter(() => RH.ajouterMembreFamille(e, fd({ lien: "CONJOINT", nom: "Premier conjoint" })))).toBeNull();
    expect(await tenter(() => RH.ajouterMembreFamille(e, fd({ lien: "ENFANT", nom: "Enfant" })))).toBeNull();
    expect(await prisma.membreFamille.count({ where: { employeeId: e } })).toBe(2);
  });

  it("« Enregistrer » les ingrédients sans en retirer : permis hors Direction (quantité modifiée)", async () => {
    const k = await creerIngredient();
    const [ficheId, ligneId] = k.split("|");
    const l = await prisma.ingredientFiche.findUniqueOrThrow({ where: { id: ligneId } });
    en("STOCK");
    expect(await tenter(() => FICHES.remplacerIngredients(ficheId, [{ id: l.id, articleId: l.articleId, sousFicheId: null, unite: "g", quantite: "120" }]))).toBeNull();
    expect(Number((await prisma.ingredientFiche.findUniqueOrThrow({ where: { id: ligneId } })).quantite)).toBe(120);
  });

  it("aucune action ne supprime un salarié : la fiche se désactive (Direction), elle ne s'efface jamais", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const lister = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((x) => x.isDirectory() ? lister(path.join(d, x.name)) : [path.join(d, x.name)]);
    const coupables = lister(path.join(__dirname, ".."))
      .filter((p) => /\.(ts|tsx)$/.test(p) && !/\.test\./.test(p))
      .filter((p) => /\bemployee\.(delete|deleteMany)\s*\(/.test(fs.readFileSync(p, "utf8")));
    expect(coupables).toEqual([]);
  });
});

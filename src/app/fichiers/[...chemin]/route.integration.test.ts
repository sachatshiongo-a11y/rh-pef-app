import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { PrismaClient, Role } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

/**
 * `/fichiers/<chemin>` — UN SALARIÉ N'OUVRE QUE SES FICHIERS.
 *
 * Avant le 2026-09-28, la route signait une URL pour TOUT compte connecté. Les chemins se devinent
 * (`documents/<employeeId>-<horodatage>.pdf`, photos `<employeeId>-<horodatage>.jpg`) et les
 * identifiants des collègues circulent dans l'espace salarié.
 *
 * Le propriétaire se lit dans la BASE : on prouve ici qu'un salarié ouvre son document et sa photo,
 * pas ceux d'un collègue ; que la RH ouvre tout, y compris un chemin inconnu en base ; que l'espace
 * Stock ouvre ses factures, bons de commande et photos de plats — et rien d'autre.
 * Supabase n'est jamais appelé : `fetch` est simulé et on vérifie QUI a obtenu une signature.
 */
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
type Compte = { id: string; email: string; nom: string; role: Role; accesStock: boolean; employeeId: string | null };
const A = vi.hoisted(() => ({ user: null as unknown as Compte }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));
vi.mock("@/lib/auth", () => ({ verifySession: async () => A.user }));

const signes: string[] = [];
vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://stockage.test");
vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "cle-de-test");
vi.stubGlobal("fetch", async (url: string) => {
  const chemin = String(url).replace("https://stockage.test/storage/v1/object/sign/employes/", "");
  signes.push(chemin);
  return new Response(JSON.stringify({ signedURL: `/object/sign/employes/${chemin}?token=t` }), { status: 200 });
});

const { GET } = await import("./route");

let prisma: PrismaClient;
let fermer: () => Promise<void>;
let moiId: string;
let collegueId: string;

const DOC_MOI = (id: string) => `documents/${id}-1700000000000.pdf`;
const PHOTO = (id: string) => `${id}-1700000000001.jpg`;
const CERTIF = (id: string) => `certificats/${id}-1700000000002.pdf`;
const CONTRAT_FIGE = (id: string) => `contrats/${id}.pdf`;
const FACTURE = "factures/fournisseur-kin-abc123.pdf";
const BC = "bons-commande/bc-001.pdf";
const PHOTO_PLAT = "fiches-techniques/plat-1-1700000000003.webp";
const INCONNU = "parametres/signature-1700000000004.png";

const compte = (role: Role, employeeId: string | null, accesStock = false): Compte =>
  ({ id: `u-${role}`, email: `${role}@test.pef`, nom: role, role, accesStock, employeeId });

async function ouvrir(chemin: string): Promise<Response> {
  signes.length = 0;
  return GET(new Request(`http://localhost/fichiers/${chemin}`) as never, { params: Promise.resolve({ chemin: chemin.split("/") }) });
}
async function autorise(chemin: string) {
  const r = await ouvrir(chemin);
  expect(r.status, chemin).toBe(302);
  expect(r.headers.get("Location")).toContain(`/storage/v1/object/sign/employes/${chemin}`);
  expect(signes).toEqual([chemin.split("/").map(encodeURIComponent).join("/")]);
}
async function refuse(chemin: string) {
  const r = await ouvrir(chemin);
  expect(r.status, chemin).toBe(403);
  expect(r.headers.get("Location")).toBeNull();
  expect(signes, "aucune URL signée ne doit être demandée").toEqual([]);
}

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;

  const emp = (matricule: string, nom: string) =>
    prisma.employee.create({
      data: {
        matricule, nom, sexe: "F", etatCivil: "Célibataire", poste: "Cuisinière", secteur: "Cuisine",
        categorie: "BRIGADE", salaireMensuel: 300, dateEmbauche: new Date("2025-01-01"), contrat: "CDI",
      },
    });
  moiId = (await emp("MO01-PEF", "Moi Salariée")).id;
  collegueId = (await emp("CO01-PEF", "Collègue")).id;

  for (const id of [moiId, collegueId]) {
    await prisma.employee.update({ where: { id }, data: { photoUrl: `/fichiers/${PHOTO(id)}` } });
    await prisma.documentEmploye.create({ data: { employeeId: id, type: "CERTIFICAT_MEDICAL", nom: "Doc", fichierUrl: `/fichiers/${DOC_MOI(id)}` } });
    await prisma.documentEmploye.create({ data: { employeeId: id, type: "CERTIFICAT_MEDICAL", nom: "Certif", fichierUrl: `/fichiers/${CERTIF(id)}` } });
    const c = await prisma.contrat.create({
      data: { employeeId: id, type: "CDI", dateDebut: new Date("2025-01-01"), salaireMensuel: 300, poste: "Cuisinière" },
    });
    await prisma.contrat.update({ where: { id: c.id }, data: { pdfAccepteUrl: `/fichiers/${CONTRAT_FIGE(id)}` } });
  }
  await prisma.factureFournisseur.create({
    data: { fournisseurNom: "Fournisseur Kin", montantUSD: 10, mois: 7, annee: 2026, documentUrl: `/fichiers/${FACTURE}` },
  });
  await prisma.bonDeCommande.create({
    data: { numero: "001/PEF/JUIL/26", sequence: 1, annee: 2026, mois: 7, documentUrl: `/fichiers/${BC}` },
  });
  await prisma.ficheTechnique.create({ data: { nom: "Plat 1", photoUrl: `/fichiers/${PHOTO_PLAT}` } });
}, 120_000);

afterAll(async () => { await fermer?.(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("un salarié n'ouvre que SES fichiers", () => {
  it("ses fichiers : document, certificat, photo, contrat figé", async () => {
    A.user = compte("EMPLOYE", moiId);
    await autorise(DOC_MOI(moiId));
    await autorise(CERTIF(moiId));
    await autorise(PHOTO(moiId));
    await autorise(CONTRAT_FIGE(moiId));
  });

  it("ceux d'un collègue : refusés, même en devinant le chemin", async () => {
    A.user = compte("EMPLOYE", moiId);
    await refuse(DOC_MOI(collegueId));
    await refuse(CERTIF(collegueId));
    await refuse(PHOTO(collegueId));
    await refuse(CONTRAT_FIGE(collegueId));
  });

  it("chemin inconnu en base, pièces du stock : refusés", async () => {
    A.user = compte("EMPLOYE", moiId);
    await refuse(INCONNU);
    await refuse(FACTURE);
    await refuse(PHOTO_PLAT);
  });
});

describe("la RH ouvre tout", () => {
  for (const role of ["ADMIN", "MANAGER", "VIEWER"] as const) {
    it(role, async () => {
      A.user = compte(role, null);
      for (const c of [DOC_MOI(moiId), DOC_MOI(collegueId), PHOTO(collegueId), CONTRAT_FIGE(collegueId), FACTURE, BC, PHOTO_PLAT, INCONNU]) {
        await autorise(c);
      }
    });
  }
});

describe("l'espace Stock ouvre ses pièces, et rien des dossiers salariés", () => {
  it("STOCK sans fiche : factures, bons de commande, photos de plats — pas les documents RH", async () => {
    A.user = compte("STOCK", null);
    await autorise(FACTURE);
    await autorise(BC);
    await autorise(PHOTO_PLAT);
    await refuse(DOC_MOI(moiId));
    await refuse(PHOTO(moiId));
    await refuse(INCONNU);
  });

  it("salarié avec accès Stock : les pièces du stock + SES fichiers, pas ceux du collègue", async () => {
    A.user = compte("EMPLOYE", moiId, true);
    await autorise(FACTURE);
    await autorise(PHOTO_PLAT);
    await autorise(DOC_MOI(moiId));
    await refuse(DOC_MOI(collegueId));
  });

  it("magasinier (STOCK) relié à sa fiche : sa photo (avatar de la coquille), pas celle du collègue", async () => {
    A.user = compte("STOCK", moiId);
    await autorise(PHOTO(moiId));
    await refuse(PHOTO(collegueId));
  });
});

describe("autres comptes", () => {
  it("COMPTA sans fiche : rien", async () => {
    A.user = compte("COMPTA", null);
    await refuse(FACTURE);
    await refuse(DOC_MOI(moiId));
  });

  it("chemin piégé : 400 avant toute vérification", async () => {
    A.user = compte("ADMIN", null);
    for (const segments of [["..", "x"], ["a", "", "b"], ["a\\b"]]) {
      signes.length = 0;
      const r = await GET(new Request("http://localhost/fichiers/x") as never, { params: Promise.resolve({ chemin: segments }) });
      expect(r.status).toBe(400);
      expect(signes).toEqual([]);
    }
  });
});

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";
import { jourCivilKinshasa } from "@/lib/heure-kinshasa";

// CONGÉS — L'ÉCRAN, rendu de la VRAIE page (refonte 2026-10-09) : sections dans l'ordre, « Passés » paginée,
// filtres (statut, type, recherche, période) qui portent sur TOUT l'ensemble, compteurs de pastilles sur tout
// l'ensemble, regroupement par mois, droits. 141 demandes : 3 à traiter, 2 en cours, 2 à venir, 4 refusées, 130 passées approuvées.
vi.setConfig({ testTimeout: 30_000 });
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
const A = vi.hoisted(() => ({ user: { id: "seed", role: "ADMIN", nom: "Sacha Test", email: "cg@pef.cd", accesStock: false, employeeId: null as string | null } }));
vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));
vi.mock("@/lib/auth", async () => {
  const vrai = await vi.importActual<typeof import("@/lib/auth")>("@/lib/auth");
  return { ...vrai, verifySession: async () => A.user, requireModule: () => {}, requireRole: () => {} };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => {}, push: () => {} }), useSearchParams: () => null, usePathname: () => "/conges" }));
vi.mock("../signature-actions", () => ({ faireSignerDocument: async () => ({}) }));
vi.mock("./calendrier", () => ({ CalendrierAbsences: () => null }));

let fermer: () => Promise<void>;
let prisma: PrismaClient;
const texte = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/[\s  ]+/g, " ");
async function rendre(sp: Record<string, string> = {}) {
  const { default: Page } = await import("./page");
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve(sp) }));
}
/** Les lignes du TABLEAU (la vue ordinateur), dans l'ordre : nom du salarié. */
function lignes(html: string): string[] {
  const t = html.slice(html.indexOf('data-vue="tableau"'), html.indexOf('data-vue="cartes"'));
  return [...t.matchAll(/aria-label="Sélectionner la demande de (Salarié \d+) \(/g)].map((m) => m[1]);
}
const sections = (html: string) => [...html.slice(html.indexOf('data-vue="tableau"'), html.indexOf('data-vue="cartes"')).matchAll(/data-section="([A-Z_]+)"/g)].map((m) => m[1]);
const pastille = (html: string, libelle: string) => new RegExp(`${libelle.replace(/[()]/g, "\\$&")} \\((\\d+)\\)`).exec(texte(html))?.[1];

const JOUR = jourCivilKinshasa(new Date());
const plus = (n: number) => new Date(JOUR.getTime() + n * 86_400_000);
const iso = (d: Date) => d.toISOString().slice(0, 10);

beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  await prisma.employee.createMany({
    data: Array.from({ length: 150 }, (_, i) => ({
      matricule: `M-${String(i + 1).padStart(3, "0")}`, nom: `Salarié ${String(i + 1).padStart(3, "0")}`, sexe: "F", etatCivil: "Célibataire", poste: "Cuisinier", secteur: "Cuisine",
      categorie: "BRIGADE" as const, salaireMensuel: 300, dateEmbauche: new Date("2024-01-01"), contrat: "CDI",
    })),
  });
  await prisma.typeConge.createMany({ data: [{ nom: "Congé annuel", ordre: 1 }, { nom: "Congé maladie", ordre: 2 }] });
  const emps = await prisma.employee.findMany({ orderBy: { matricule: "asc" } });
  const e = (n: number) => emps[n - 1].id;
  const d = (n: number, type: string, debut: number, fin: number, statut: "EN_ATTENTE" | "APPROUVE" | "REFUSE") =>
    ({ employeeId: e(n), type, dateDebut: plus(debut), dateFin: plus(fin), nbJours: Math.max(1, fin - debut + 1), statut });
  await prisma.leaveRequest.createMany({
    data: [
      // À traiter : 3 (dont une dont les dates sont déjà passées : elle reste « à traiter »)
      d(1, "Congé annuel", 10, 12, "EN_ATTENTE"), d(2, "Congé maladie", 20, 25, "EN_ATTENTE"), d(3, "Congé annuel", -20, -18, "EN_ATTENTE"),
      // En cours aujourd'hui : 2 (l'une finit aujourd'hui, l'autre commence aujourd'hui)
      d(4, "Congé annuel", -3, 0, "APPROUVE"), d(5, "Congé maladie", 0, 4, "APPROUVE"),
      // À venir : une dans les 30 jours, une à +60 jours
      d(6, "Congé annuel", 15, 18, "APPROUVE"), d(7, "Congé annuel", 60, 64, "APPROUVE"),
      // Refusés : 4 (dont un à venir : il est « passé/clôturé »)
      d(8, "Congé maladie", 30, 31, "REFUSE"), d(9, "Congé annuel", -40, -38, "REFUSE"), d(10, "Congé annuel", -41, -39, "REFUSE"), d(11, "Congé maladie", -42, -40, "REFUSE"),
      // Passés approuvés : 130, du plus récent (n° 12, fini hier) au plus ancien
      ...Array.from({ length: 130 }, (_, i) => d(12 + i, i % 2 === 0 ? "Congé annuel" : "Congé maladie", -10 - i * 7, -8 - i * 7, "APPROUVE")),
    ],
  });
}, 120_000);
afterAll(async () => { await fermer?.(); });

describe("Congés — sections", () => {
  it("par défaut : À traiter, En cours, À venir, Passés ; « Passés » repliée (ni lignes ni barre de pagination)", async () => {
    const html = await rendre();
    expect(sections(html)).toEqual(["A_TRAITER", "EN_COURS", "A_VENIR", "PASSES"]);
    // à traiter (par date de début), en cours (par date de fin), à venir : 3 + 2 + 2 lignes seulement
    expect(lignes(html)).toEqual(["Salarié 003", "Salarié 001", "Salarié 002", "Salarié 004", "Salarié 005", "Salarié 006", "Salarié 007"]);
    expect(html).not.toContain('data-pagination=""');
    expect(texte(html)).toContain("Passés (134)");
  });

  it("un congé qui finit (ou commence) aujourd'hui est « en cours » (jour civil de Kinshasa)", async () => {
    const html = await rendre();
    const enCours = html.slice(html.indexOf('data-section="EN_COURS"'), html.indexOf('data-section="A_VENIR"'));
    expect(enCours).toContain("Salarié 004");
    expect(enCours).toContain("Salarié 005");
  });

  it("page demandée : « Passés » s'ouvre, 50 par page, du plus récent au plus ancien ; refusés mêlés aux passés", async () => {
    const p1 = await rendre({ page: "1" });
    expect(lignes(p1)).toHaveLength(7 + 50);
    expect(lignes(p1).slice(7, 9)).toEqual(["Salarié 008", "Salarié 012"]); // le refus à venir (début le plus tardif), puis la plus récente des passées approuvées (finie hier)
    expect(texte(p1)).toContain("1–50 sur 134 demandes");
    const p3 = await rendre({ page: "3" });
    expect(lignes(p3)).toHaveLength(7 + 34);
    expect(texte(p3)).toContain("101–134 sur 134");
    expect(lignes(await rendre({ par: "tout" }))).toHaveLength(7 + 134);
  });
});

describe("Congés — pastilles et compteurs (sur tout l'ensemble)", () => {
  it("compteurs : tous 141, en attente 3, en congé aujourd'hui 2, à venir (30 j) 1, approuvés 134, refusés 4", async () => {
    const html = await rendre();
    expect(pastille(html, "Tous")).toBe("141");
    expect(pastille(html, "En attente")).toBe("3");
    expect(pastille(html, "En congé aujourd'hui")).toBe("2");
    expect(pastille(html, "À venir (30 j)")).toBe("1");
    expect(pastille(html, "Approuvés")).toBe("134");
    expect(pastille(html, "Refusés")).toBe("4");
  });

  it("filtrer par statut ne change pas les compteurs des autres pastilles ; la liste ne garde que ce statut", async () => {
    const html = await rendre({ statut: "REFUSE" });
    expect(pastille(html, "En attente")).toBe("3");
    expect(pastille(html, "Refusés")).toBe("4");
    expect(sections(html)).toEqual(["PASSES"]); // les refusés sont tous « passés »
    expect(lignes(html).sort()).toEqual(["Salarié 008", "Salarié 009", "Salarié 010", "Salarié 011"]);
  });

  it("« En congé aujourd'hui » et « À venir (30 j) » filtrent la liste ; à venir à +60 j n'y est pas", async () => {
    expect(lignes(await rendre({ statut: "APPROUVE", quand: "en-cours" })).sort()).toEqual(["Salarié 004", "Salarié 005"]);
    expect(lignes(await rendre({ statut: "APPROUVE", quand: "a-venir" }))).toEqual(["Salarié 006"]);
  });

  it("type et recherche : portent sur tout l'ensemble, et les compteurs des pastilles les suivent", async () => {
    const html = await rendre({ type: "Congé maladie", par: "tout" });
    expect(pastille(html, "Tous")).toBe("69"); // 4 (n° 2, 5, 8, 11) + 65 passées approuvées
    expect(pastille(html, "Congé maladie")).toBe("69");
    expect(pastille(html, "Congé annuel")).toBe("72"); // les compteurs de type ignorent le type choisi
    const recherche = await rendre({ q: "salarié 006" });
    expect(lignes(recherche)).toEqual(["Salarié 006"]);
    expect(pastille(recherche, "Tous")).toBe("1");
    expect(pastille(recherche, "En attente")).toBe("0");
    expect(pastille(recherche, "À venir (30 j)")).toBe("1");
  });

  it("statut inconnu : aucune demande (comme avant)", async () => {
    expect(lignes(await rendre({ statut: "N_IMPORTE_QUOI" }))).toHaveLength(0);
  });
});

describe("Congés — période", () => {
  it("un mois : toute demande qui le chevauche (une qui commence avant et finit dedans compte)", async () => {
    const m = iso(plus(15)).slice(0, 7);
    const html = await rendre({ mois: m, statut: "APPROUVE", quand: "a-venir" });
    expect(lignes(html)).toEqual(["Salarié 006"]); // +15 → +18 est dans ce mois (ou le chevauche)
    const plage = await rendre({ du: iso(plus(15)), au: iso(plus(16)) });
    expect(lignes(plage)).toEqual(["Salarié 006"]); // +15 → +18 chevauche [+15, +16]
    expect(lignes(await rendre({ du: iso(plus(200)) }))).toHaveLength(0);
  });
});

describe("Congés — regroupement par mois", () => {
  it("une seule liste paginée, titres de mois, du plus récent au plus ancien", async () => {
    const html = await rendre({ groupe: "mois" });
    expect(sections(html)).toEqual([]);
    expect(lignes(html)).toHaveLength(50);
    expect(texte(html)).toContain("1–50 sur 141 demandes");
    const titres = [...html.matchAll(/data-groupe="(\d{4}-\d{2})"/g)].map((m) => m[1]);
    const uniques = [...new Set(titres)];
    expect(uniques).toEqual([...uniques].sort().reverse());
    expect(lignes(html)[0]).toBe("Salarié 007"); // la demande qui commence le plus tard (+60 j)
  });
});

describe("Congés — adresses et droits", () => {
  it("les liens de la barre gardent TOUS les filtres, pas les messages d'erreur", async () => {
    const html = await rendre({ statut: "APPROUVE", q: "salarié", mois: "2020-01", erreurDecision: "Boum", erreur: "Zut", page: "1", par: "50" });
    expect(html).not.toContain("erreurDecision=Boum&amp;");
    const html2 = await rendre({ statut: "APPROUVE", type: "Congé annuel" });
    expect(html2).toContain('href="/conges?statut=APPROUVE&amp;type=Cong%C3%A9+annuel&amp;page=2"');
  });

  it("Direction : bouton « Nouvelle demande », Approuver / Refuser, cases ; Responsable : bouton, cases, pas de décision ; lecture : ni bouton ni signature", async () => {
    const admin = await rendre();
    expect(admin).toContain("Nouvelle demande");
    expect(admin).toContain("Approuver");
    A.user.role = "MANAGER";
    try {
      const resp = await rendre();
      expect(resp).toContain("Nouvelle demande");
      expect(resp).not.toContain("Approuver");
      expect(resp).toContain('type="checkbox"');
      A.user.role = "VIEWER";
      const lecture = await rendre();
      expect(lecture).not.toContain("Nouvelle demande");
      expect(lecture).not.toContain("Approuver");
      expect(lecture).not.toContain("Signer");
      expect(lecture).toContain("PDF");
    } finally { A.user.role = "ADMIN"; }
  });

  it("aucune demande : l'état vide ; filtre sans résultat : « pour ce filtre »", async () => {
    expect(texte(await rendre({ q: "zzzzzz" }))).toContain("Aucune demande de congé pour ce filtre.");
  });
});

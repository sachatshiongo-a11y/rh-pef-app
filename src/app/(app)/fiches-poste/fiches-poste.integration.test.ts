import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import JSZip from "jszip";
import { creerBaseTest } from "@/lib/test/db";

// Actions groupées de l'écran Fiches de poste, sur une vraie base : suppression en lot (Direction
// seulement, rien ne bouge sinon ; postes et employés conservés ; journalisée) et PDF en lot (un
// ZIP : un fichier par fiche, produit par le même générateur et sous le même nom que la route unitaire).

const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
const A = vi.hoisted(() => ({ user: { id: "", email: "d@pef.cd", nom: "Direction", role: "ADMIN" as string, accesStock: false, employeeId: null as string | null } }));
const G = vi.hoisted(() => ({ refus: false }));

vi.mock("@/lib/prisma", () => ({
  prisma: new Proxy({}, {
    get: (_t, p) => {
      const v = (H.client as unknown as Record<string | symbol, unknown>)[p];
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(H.client) : v;
    },
  }),
}));
vi.mock("@/lib/auth", () => ({
  verifySession: async () => A.user,
  requireRole: (u: { role: string }, roles: string[]) => { if (!roles.includes(u.role)) throw new Error("Accès refusé : rôle insuffisant."); },
}));
vi.mock("@/lib/garde-route", () => ({
  exigerEspaceRH: async () => (G.refus ? { ok: false, reponse: new Response("Interdit", { status: 403 }) } : { ok: true, user: A.user }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw Object.assign(new Error(`REDIRECT ${url}`), { digest: `NEXT_REDIRECT;${url}`, url }); },
}));

const POSTES = await import("./actions");
const LOT = await import("./pdf-lot/route");

let prisma: PrismaClient;
let fermer: () => Promise<void>;

async function envoyer(f: () => Promise<unknown>): Promise<string> {
  try { await f(); } catch (e) { const url = (e as { url?: string }).url; if (url) return url; throw e; }
  return "";
}

beforeAll(async () => {
  ({ prisma, fermer } = await creerBaseTest());
  H.client = prisma;
  A.user.id = (await prisma.user.create({ data: { email: "d@pef.cd", nom: "Direction", role: "ADMIN" } })).id;
});
afterAll(async () => { await fermer?.(); });
beforeEach(async () => {
  A.user.role = "ADMIN";
  G.refus = false;
  await prisma.journalAudit.deleteMany();
  await prisma.fichePoste.deleteMany();
});

const fiches = async () => Promise.all([
  prisma.fichePoste.create({ data: { poste: "Cuisinière", descriptionPoste: "Prépare les plats" } }),
  prisma.fichePoste.create({ data: { poste: "Serveuse", description: "Sert en salle" } }),
  prisma.fichePoste.create({ data: { poste: "Barman" } }),
]);

describe("suppression groupée des fiches", () => {
  it("Responsable RH refusé : rien n'est supprimé", async () => {
    const [a, b] = await fiches();
    A.user.role = "MANAGER";
    const fd = new FormData(); fd.append("ficheId", a.id); fd.append("ficheId", b.id);
    expect(await envoyer(() => POSTES.supprimerFichesPoste(fd))).toMatch(/erreur=.*r%C3%B4le%20insuffisant/);
    expect(await prisma.fichePoste.count()).toBe(3);
  });

  it("Direction : seules les fiches cochées partent, chacune journalisée", async () => {
    const [a, b] = await fiches();
    const fd = new FormData(); fd.append("ficheId", a.id); fd.append("ficheId", b.id); fd.append("ficheId", a.id);
    expect(decodeURIComponent(await envoyer(() => POSTES.supprimerFichesPoste(fd)))).toContain("2 fiche(s) de poste supprimée(s)");
    expect((await prisma.fichePoste.findMany()).map((f) => f.poste)).toEqual(["Barman"]);
    expect((await prisma.journalAudit.findMany({ where: { entite: "FichePoste", champ: "suppression" } })).map((j) => j.entiteId).sort()).toEqual(["Cuisinière", "Serveuse"]);
  });
});

describe("PDF en lot (ZIP)", () => {
  it("un PDF par fiche demandée, nommé comme l'unitaire ; ids inconnus ignorés", async () => {
    const [a, b] = await fiches();
    const res = await LOT.GET(new Request(`http://x/fiches-poste/pdf-lot?ids=${a.id},${b.id},inconnu`));
    expect(res.headers.get("Content-Type")).toBe("application/zip");
    const zip = await JSZip.loadAsync(Buffer.from(await res.arrayBuffer()));
    expect(Object.keys(zip.files).sort()).toEqual(["Fiche_de_poste_Cuisiniere.pdf", "Fiche_de_poste_Serveuse.pdf"]);
    const pdf = await zip.file("Fiche_de_poste_Cuisiniere.pdf")!.async("nodebuffer");
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  }, 60000);

  it("garde refusée : la réponse de la garde, rien de généré ; aucun id : 400", async () => {
    G.refus = true;
    expect((await LOT.GET(new Request("http://x/fiches-poste/pdf-lot?ids=a"))).status).toBe(403);
    G.refus = false;
    expect((await LOT.GET(new Request("http://x/fiches-poste/pdf-lot?ids="))).status).toBe(400);
    // Au-delà du plafond : refus explicite, jamais un ZIP tronqué en silence.
    const trop = Array.from({ length: 51 }, (_, i) => `id${i}`).join(",");
    const refus = await LOT.GET(new Request(`http://x/fiches-poste/pdf-lot?ids=${trop}`));
    expect(refus.status).toBe(400);
    expect(await refus.text()).toBe("50 fiches au plus par lot");
  });
});

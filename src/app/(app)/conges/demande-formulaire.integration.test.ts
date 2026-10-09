import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { PrismaClient } from "@prisma/client";
import { creerBaseTest } from "@/lib/test/db";

// CONGÉS — FORMULAIRE « NOUVELLE DEMANDE » (refonte de l'écran, 2026-10-09). Le formulaire change de
// DÉCOR (bloc repliable → panneau latéral) mais PAS de contrat : mêmes champs, mêmes noms, mêmes
// valeurs envoyées à `demanderConge`. Ce test fige ce contrat sur le rendu de la VRAIE page, avant la
// refonte ; il doit rester vert, tel quel, après.
const H = vi.hoisted(() => ({ client: undefined as unknown as PrismaClient }));
const A = vi.hoisted(() => ({ user: { id: "seed", role: "ADMIN", nom: "Sacha Test", email: "fg@pef.cd", accesStock: false, employeeId: null as string | null } }));
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
vi.mock("../signature-actions", () => ({ faireSignerDocument: async () => ({}) }));
vi.mock("./calendrier", () => ({ CalendrierAbsences: () => null }));

let fermer: () => Promise<void>;
let prisma: PrismaClient;

async function rendre(sp: Record<string, string> = {}) {
  const { default: Page } = await import("./page");
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve(sp) }));
}

/** Le <form> qui porte le champ `employeeId` (le formulaire de demande), tel quel. */
function formulaireDemande(html: string): string {
  const fin = html.indexOf('name="employeeId"');
  expect(fin, "le formulaire de demande est dans la page").toBeGreaterThan(-1);
  const debut = html.lastIndexOf("<form", fin);
  return html.slice(debut, html.indexOf("</form>", fin) + 7);
}
/** Les champs envoyés : nom, balise, type, obligatoire — dans l'ordre du document. */
function champs(form: string) {
  return [...form.matchAll(/<(input|select|textarea)\b([^>]*)>/g)].flatMap((m) => {
    const nom = /\bname="([^"]*)"/.exec(m[2])?.[1];
    if (!nom) return [];
    return [{ nom, balise: m[1], type: /\btype="([^"]*)"/.exec(m[2])?.[1] ?? null, requis: /\brequired\b/.test(m[2]) }];
  });
}
const options = (form: string, nom: string) => {
  const debut = form.indexOf(`name="${nom}"`);
  const select = form.slice(debut, form.indexOf("</select>", debut));
  return [...select.matchAll(/<option value="([^"]*)"[^>]*>([^<]*)</g)].map((m) => [m[1], m[2]]);
};

let idA = "", idB = "";
beforeAll(async () => {
  const db = await creerBaseTest();
  prisma = db.prisma; fermer = db.fermer; H.client = prisma;
  const base = { sexe: "F", etatCivil: "Célibataire", poste: "Cuisinier", secteur: "Cuisine", categorie: "BRIGADE" as const, salaireMensuel: 300, dateEmbauche: new Date("2025-01-01"), contrat: "CDI" };
  idA = (await prisma.employee.create({ data: { ...base, matricule: "FG-1", nom: "Aimée Mutita" } })).id;
  idB = (await prisma.employee.create({ data: { ...base, matricule: "FG-2", nom: "Esther Nsundi" } })).id;
  await prisma.typeConge.createMany({ data: [{ nom: "Congé annuel", ordre: 1 }, { nom: "Congé maladie", ordre: 2 }] });
}, 120_000);
afterAll(async () => { await fermer?.(); });

describe("Congés — contrat du formulaire « Nouvelle demande »", () => {
  it("mêmes champs, mêmes noms, mêmes obligations, dans le même ordre", async () => {
    const form = formulaireDemande(await rendre());
    expect(champs(form)).toEqual([
      { nom: "employeeId", balise: "select", type: null, requis: true },
      { nom: "type", balise: "select", type: null, requis: false },
      { nom: "dateDebut", balise: "input", type: "date", requis: true },
      { nom: "nbJours", balise: "input", type: "text", requis: true },
      { nom: "dateFin", balise: "input", type: "date", requis: true },
      { nom: "remplacantId", balise: "select", type: null, requis: false },
      { nom: "motif", balise: "input", type: null, requis: false },
    ]);
    expect(form).toContain("Enregistrer la demande");
  });

  it("listes de choix : salariés actifs (par nom), types de congé actifs, remplaçant facultatif", async () => {
    const form = formulaireDemande(await rendre());
    expect(options(form, "employeeId")).toEqual([[idA, "Aimée Mutita"], [idB, "Esther Nsundi"]]);
    expect(options(form, "type")).toEqual([["Congé annuel", "Congé annuel"], ["Congé maladie", "Congé maladie"]]);
    expect(options(form, "remplacantId")).toEqual([["", "— Aucun —"], [idA, "Aimée Mutita"], [idB, "Esther Nsundi"]]);
  });

  it("réservé à la Direction et aux Responsables : un compte en lecture ne l'a pas", async () => {
    A.user.role = "VIEWER";
    try { expect(await rendre()).not.toContain('name="employeeId"'); } finally { A.user.role = "ADMIN"; }
  });
});

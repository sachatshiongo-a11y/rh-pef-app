import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { Alerte } from "@/lib/alertes";

// Rappels RH quotidiens (`/api/cron/alertes`) : depuis le 2026-10-12, les alertes de l'espace STOCK (« N facture(s)
// fournisseur à payer sous 7 jours ») n'y figurent plus — le Stock a son propre courriel détaillé
// (`/api/cron/stock-quotidien`), mêmes destinataires (ADMIN) : la répéter ici serait un doublon.
const M = vi.hoisted(() => ({
  alertes: [] as Alerte[],
  email: vi.fn(async (_a: string[], _s: string, _c: string) => {}),
  push: vi.fn(async () => {}),
  admins: [{ id: "a1", email: "direction@exemple.cd" }],
}));
vi.mock("@/lib/alertes", () => ({ calculerAlertes: async () => M.alertes }));
vi.mock("@/lib/email", () => ({ envoyerEmail: M.email }));
vi.mock("@/lib/push", () => ({ envoyerPush: M.push }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findMany: async () => M.admins } } }));

const { GET } = await import("./route");
const appel = () => GET(new NextRequest("http://localhost/api/cron/alertes", { headers: { authorization: "Bearer secret-de-test" } }));

const FACTURES: Alerte = { type: "FACTURES", espace: "STOCK", niveau: "urgent", message: "2 facture(s) fournisseur à payer sous 7 jours — 120,00 $ (dont 1 échue(s))", lien: "/stock/factures?statut=du" };
const CONGE: Alerte = { type: "CONGE_NON_VALIDE", espace: "RH", niveau: "warning", message: "Congé de Awa débute dans 5 jour(s) mais n'est pas encore validé.", lien: "/conges" };
const DOC: Alerte = { type: "DOCUMENT", espace: "RH", niveau: "info", message: "Document lointain", lien: "/employes/x" };

describe("rappels RH quotidiens : pas d'alerte du Stock", () => {
  beforeEach(() => { process.env.CRON_SECRET = "secret-de-test"; M.email.mockClear(); M.push.mockClear(); M.alertes = []; });

  it("refuse sans le bon jeton", async () => {
    const r = await GET(new NextRequest("http://localhost/api/cron/alertes"));
    expect(r.status).toBe(401);
    expect(M.email).not.toHaveBeenCalled();
  });

  it("une alerte du Stock (urgente) n'entre ni dans le courriel ni dans le compte, les rappels RH restent", async () => {
    M.alertes = [FACTURES, CONGE, DOC];
    const body = await (await appel()).json();
    expect(body).toMatchObject({ envoye: true, nombre: 1, urgents: 0 });
    const [, sujet, corps] = M.email.mock.calls[0];
    expect(sujet).toContain("1 rappel(s) du jour");
    expect(corps).toContain("Congé de Awa");
    expect(corps).not.toContain("facture(s) fournisseur");
    expect(corps).not.toContain("/stock/");
    expect(corps).not.toContain("Document lointain"); // « info » : cloche seulement, comme avant
  });

  it("seules des alertes du Stock : rien n'est envoyé (le courriel du Stock s'en charge)", async () => {
    M.alertes = [FACTURES];
    const body = await (await appel()).json();
    expect(body).toEqual({ envoye: false, nombre: 0 });
    expect(M.email).not.toHaveBeenCalled();
    expect(M.push).not.toHaveBeenCalled();
  });
});

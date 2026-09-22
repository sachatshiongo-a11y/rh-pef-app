import { describe, it, expect, vi } from "vitest";

/**
 * LA LIASSE NE PART PAS EN RAFALE CONTRE LE STOCKAGE.
 *
 * Les REQUÊTES de signature sont au nombre de trois quel que soit l'effectif, mais les tracés
 * vivent dans le stockage et se lisent un par un. Un `Promise.all` nu sur la liasse d'un effectif
 * complet ouvrirait autant de lectures Supabase simultanées qu'il y a de bulletins signés.
 */
const M = vi.hoisted(() => ({ enCours: 0, maximum: 0, lectures: 0 }));
vi.mock("@/lib/storage", () => ({
  lireFichier: async () => {
    M.enCours += 1;
    M.lectures += 1;
    M.maximum = Math.max(M.maximum, M.enCours);
    await new Promise((r) => setTimeout(r, 5));
    M.enCours -= 1;
    return Buffer.from("trace");
  },
  televerserFichier: async () => "/fichiers/x.png",
}));

const { signaturesImprimables } = await import("@/lib/signature");

/** Un client qui rend N signatures à jour et tracées, sans base : seul le stockage nous intéresse. */
function clientAvecSignatures(n: number) {
  const ids = Array.from({ length: n }, (_, i) => `doc-${i}`);
  return {
    ids,
    client: {
      signatureElectronique: {
        findMany: async () =>
          ids.map((id, i) => ({
            id: `sig-${i}`, cibleId: id, traceUrl: `/fichiers/signatures/bulletin/${id}.png`,
            signeLe: new Date(0), mode: "ESPACE_SALARIE", empreinte: "", obsolete: false,
            employee: { nom: "X", matricule: "M" }, presentePar: null,
          })),
        updateMany: async () => ({ count: 0 }),
      },
    } as never,
  };
}

describe("signaturesImprimables — lecture des tracés plafonnée", () => {
  it("200 bulletins signés n'ouvrent pas 200 lectures de stockage en même temps", async () => {
    M.enCours = 0; M.maximum = 0; M.lectures = 0;
    const { client, ids } = clientAvecSignatures(200);
    const par = await signaturesImprimables(client, "BULLETIN", ids);

    expect(par.size, "tous les tracés sont bien lus").toBe(200);
    expect(M.lectures).toBe(200);
    expect(M.maximum, `jusqu'à ${M.maximum} lectures de stockage simultanées`).toBeLessThanOrEqual(8);
  }, 60_000);
});

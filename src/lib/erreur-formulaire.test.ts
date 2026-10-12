// Le refus d'un formulaire revient soit par redirection `?erreur=` (historique), soit comme valeur
// `{ erreur }` quand l'écran le demande (CHAMP_RETOUR_ERREUR) — pour ne pas démonter sa saisie.
import { describe, it, expect, vi } from "vitest";

vi.mock("next/navigation", async () => {
  // Même forme que Next : redirect() jette une erreur dont le digest porte l'URL.
  return {
    redirect: (url: string) => { throw Object.assign(new Error("NEXT_REDIRECT"), { digest: `NEXT_REDIRECT;replace;${url};307;` }); },
  };
});

import { formulaireLisible, CHAMP_RETOUR_ERREUR } from "./erreur-formulaire";
import { redirect } from "next/navigation";

const avecRetour = () => { const fd = new FormData(); fd.set(CHAMP_RETOUR_ERREUR, "1"); return fd; };
const digestDe = async (p: Promise<unknown>) => { try { await p; } catch (e) { return String((e as { digest?: string }).digest); } return null; };

describe("formulaireLisible — sans le champ de retour : redirection ?erreur= (inchangé)", () => {
  it("une erreur métier redirige vers la page avec le message", async () => {
    const d = await digestDe(formulaireLisible("/employes/e1", async () => { throw new Error("Montant supérieur au plafond."); }, new FormData()));
    expect(d).toContain("/employes/e1?erreur=Montant%20sup%C3%A9rieur%20au%20plafond.");
  });
  it("sans formData non plus (appels historiques)", async () => {
    const d = await digestDe(formulaireLisible("/x", async () => { throw new Error("Non."); }));
    expect(d).toContain("/x?erreur=Non.");
  });
  it("une redirection de succès passe", async () => {
    const d = await digestDe(formulaireLisible("/x", async () => { redirect("/employes"); }, new FormData()));
    expect(d).toContain("/employes");
  });
});

describe("formulaireLisible — avec le champ de retour : le refus est une valeur", () => {
  it("une erreur métier est rendue { erreur } (aucune redirection : la saisie reste)", async () => {
    const r = await formulaireLisible("/employes/e1", async () => { throw new Error("Montant supérieur au plafond."); }, avecRetour());
    expect(r).toEqual({ erreur: "Montant supérieur au plafond." });
  });
  it("une erreur inattendue est rendue en message générique avec référence, jamais en brut", async () => {
    const espion = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await formulaireLisible("/x", async () => { throw new TypeError("Cannot read properties of undefined (reading 'x')"); }, avecRetour());
    espion.mockRestore();
    expect(r).toMatchObject({ erreur: expect.stringContaining("Erreur inattendue") });
    expect(JSON.stringify(r)).not.toContain("Cannot read");
  });
  it("une redirection explicite vers ?erreur= (refus écrit dans le corps) est rendue { erreur }", async () => {
    const r = await formulaireLisible("/fiches-poste", async () => { redirect(`/fiches-poste?erreur=${encodeURIComponent("Intitulé de poste manquant.")}`); }, avecRetour());
    expect(r).toEqual({ erreur: "Intitulé de poste manquant." });
  });
  it("une redirection de SUCCÈS (?msg=, autre page) passe toujours", async () => {
    const d = await digestDe(formulaireLisible("/fiches-poste", async () => { redirect("/fiches-poste?msg=Enregistr%C3%A9e"); }, avecRetour()));
    expect(d).toContain("msg=Enregistr");
  });
  it("une réussite sans redirection rend undefined", async () => {
    expect(await formulaireLisible("/x", async () => undefined, avecRetour())).toBeUndefined();
  });
});

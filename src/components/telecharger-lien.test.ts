import { describe, it, expect } from "vitest";
import { verdictReponseDocument } from "./telecharger-lien";

/**
 * Le piège : `fetch` suit les redirections et le garde d'auth REDIRIGE vers /login au lieu de
 * refuser. Une session expirée renvoie donc 200 avec la page de connexion — `ok` est vrai. Sans
 * le contrôle de `redirected`, on enregistre cet écran HTML sous le nom du bulletin.
 */
describe("verdictReponseDocument", () => {
  it("une redirection est une session expirée, MÊME si la réponse est un succès", () => {
    expect(verdictReponseDocument({ redirected: true, ok: true })).toBe("session-expiree");
  });

  it("une réponse directe et réussie est le document", () => {
    expect(verdictReponseDocument({ redirected: false, ok: true })).toBe("ok");
  });

  it("une réponse directe en échec est une erreur", () => {
    expect(verdictReponseDocument({ redirected: false, ok: false })).toBe("erreur");
  });

  it("une redirection VERS une erreur reste une session expirée", () => {
    expect(verdictReponseDocument({ redirected: true, ok: false })).toBe("session-expiree");
  });
});

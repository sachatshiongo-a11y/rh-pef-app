import { describe, it, expect } from "vitest";
import { verdictReponseDocument, issuePartage } from "./telecharger-lien";

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

/**
 * La feuille de partage annulée n'est PAS un enregistrement. Sur l'écran des comptes en lot, le
 * PDF est le seul exemplaire des mots de passe : prendre une annulation pour un succès retirait la
 * garde de sortie, et l'administrateur qui quittait la page perdait tout le lot.
 */
describe("issuePartage", () => {
  it("une feuille de partage conclue est un partage", () => {
    expect(issuePartage({ ok: true })).toBe("partage");
  });

  it("une annulation (AbortError) n'est PAS un enregistrement", () => {
    expect(issuePartage({ erreur: new DOMException("Share canceled", "AbortError") })).toBe("annule");
  });

  it("toute autre erreur passe au repli (lien de téléchargement)", () => {
    expect(issuePartage({ erreur: new DOMException("Not allowed", "NotAllowedError") })).toBe("repli");
    expect(issuePartage({ erreur: new TypeError("boom") })).toBe("repli");
    expect(issuePartage({ erreur: null })).toBe("repli");
    expect(issuePartage({ erreur: "chaîne" })).toBe("repli");
  });
});

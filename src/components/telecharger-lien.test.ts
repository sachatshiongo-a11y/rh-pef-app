import { describe, it, expect } from "vitest";
import { verdictReponseDocument, messageEchecDocument, adresseDeFormulaire, issuePartage } from "./telecharger-lien";

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

  it("une redirection qui atterrit CHEZ NOUS (la page de connexion) est une session expirée", () => {
    expect(
      verdictReponseDocument({ redirected: true, ok: true, url: "https://gestion.example.cd/login", origine: "https://gestion.example.cd" }),
    ).toBe("session-expiree");
  });

  it("une redirection vers une AUTRE origine (l'URL signée du stockage, /fichiers/…) est un fichier, pas une session expirée", () => {
    expect(
      verdictReponseDocument({
        redirected: true,
        ok: true,
        url: "https://projet.supabase.co/storage/v1/object/sign/employes/x.pdf?token=t",
        origine: "https://gestion.example.cd",
        contentType: "application/pdf",
      }),
    ).toBe("ok");
  });

  it("un 401 (le garde répond sans redirection aux requêtes de fichier) est une session expirée", () => {
    expect(verdictReponseDocument({ redirected: false, ok: false, status: 401 })).toBe("session-expiree");
  });

  it("un 403 est un refus, pas une panne", () => {
    expect(verdictReponseDocument({ redirected: false, ok: false, status: 403 })).toBe("refuse");
  });

  it("un 404 / 409 / 500 est une erreur", () => {
    for (const status of [400, 404, 409, 500]) expect(verdictReponseDocument({ redirected: false, ok: false, status })).toBe("erreur");
  });

  it("une PAGE HTML n'est jamais un document, même servie en 200", () => {
    expect(verdictReponseDocument({ redirected: false, ok: true, status: 200, contentType: "text/html; charset=utf-8" })).toBe("pas-un-document");
  });

  it("un PDF, un tableur, une archive sont des documents", () => {
    for (const contentType of [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/zip",
      "image/jpeg",
    ]) {
      expect(verdictReponseDocument({ redirected: false, ok: true, status: 200, contentType })).toBe("ok");
    }
  });
});

describe("messageEchecDocument", () => {
  it("dit clairement que la session a expiré", () => {
    expect(messageEchecDocument("session-expiree")).toMatch(/session a expiré/);
  });

  it("donne telle quelle la phrase précise du serveur (un bon de commande non validé, une paie non calculée…)", () => {
    expect(messageEchecDocument("erreur", "Le bon de commande doit être validé avant d'être exporté.")).toBe(
      "Le bon de commande doit être validé avant d'être exporté.",
    );
    expect(messageEchecDocument("refuse", "Accès refusé : seule la Direction imprime l'affiche de pointage.")).toMatch(/Direction/);
  });

  it("n'affiche jamais un texte trop long (une page d'erreur entière) dans une boîte de dialogue", () => {
    expect(messageEchecDocument("erreur", "x".repeat(500))).toMatch(/n'a pas pu être récupéré/);
  });

  it("sans texte du serveur : un message par défaut, jamais vide", () => {
    for (const v of ["refuse", "erreur", "pas-un-document"] as const) expect(messageEchecDocument(v).length).toBeGreaterThan(10);
  });
});

describe("adresseDeFormulaire", () => {
  it("compose l'adresse comme le ferait un formulaire GET", () => {
    expect(adresseDeFormulaire("/stock/journalier/fiche", [["type", "commande"], ["date", "2026-09-30"], ["format", "pdf"]])).toBe(
      "/stock/journalier/fiche?type=commande&date=2026-09-30&format=pdf",
    );
  });

  it("sans champ, l'adresse reste telle quelle", () => {
    expect(adresseDeFormulaire("/stock/legumes/fiche", [])).toBe("/stock/legumes/fiche");
  });

  it("conserve un paramètre déjà présent dans l'action", () => {
    expect(adresseDeFormulaire("/x?a=1", [["b", "2"]])).toBe("/x?a=1&b=2");
  });

  it("ignore un fichier joint (pas une valeur texte)", () => {
    expect(adresseDeFormulaire("/x", [["f", new Blob(["a"])], ["b", "2"]])).toBe("/x?b=2");
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

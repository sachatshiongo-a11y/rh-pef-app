import { describe, it, expect } from "vitest";
import { dejaLeger, formatPoids, POIDS_CIBLE_OCTETS } from "./reduire-photo";

// `reduireImage` dessine sur un <canvas> réel : hors de portée de l'environnement de test « node »
// (pas de DOM ici, cf. vitest.config.ts). On verrouille donc la partie pure — la décision de
// réduire ou non, et la mise en forme du poids — laissant le dessin/compression à la vérification
// visuelle en navigateur.

describe("dejaLeger", () => {
  it("une photo sous la cible n'a pas besoin d'être retouchée", () => {
    expect(dejaLeger(POIDS_CIBLE_OCTETS)).toBe(true);
    expect(dejaLeger(1024)).toBe(true);
  });

  it("une photo au-dessus de la cible doit être réduite", () => {
    expect(dejaLeger(POIDS_CIBLE_OCTETS + 1)).toBe(false);
    expect(dejaLeger(5 * 1024 * 1024)).toBe(false);
  });
});

describe("formatPoids", () => {
  it("affiche en Ko sous 1 Mo", () => {
    expect(formatPoids(210 * 1024)).toBe("210 Ko");
  });

  it("affiche en Mo au-delà, avec une décimale", () => {
    expect(formatPoids(4.8 * 1024 * 1024)).toBe("4,8 Mo");
  });
});

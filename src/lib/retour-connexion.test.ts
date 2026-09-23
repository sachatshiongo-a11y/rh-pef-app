import { describe, it, expect } from "vitest";
import { retourValide, retourPourChemin } from "./retour-connexion";

// ─────────────────────────────────────────────────────────────────────────────
// LE RETOUR APRÈS CONNEXION — une seule destination permise : le scan de l'affiche.
//
// Un salarié qui scanne l'affiche avec l'appareil photo du téléphone arrive sur `/scan?c=…` dans
// un navigateur SANS session (sur iPhone, Safari ne partage pas la session de l'application
// installée). Il passe par la connexion, puis revient au scan. Ce `retour` voyage dans l'adresse :
// n'importe qui peut en fabriquer un. S'il était honoré tel quel, un lien piégé
// « /login?retour=https://faux-site » renverrait un salarié, juste après qu'il a tapé son mot de
// passe, vers un site qui imite l'application — une REDIRECTION OUVERTE. D'où une liste blanche
// d'UNE entrée, et tout le reste refusé.
// ─────────────────────────────────────────────────────────────────────────────

describe("retourValide : seul /scan?… est honoré", () => {
  it("accepte le chemin du scan avec son code", () => {
    expect(retourValide("/scan?c=abc_DEF-123")).toBe("/scan?c=abc_DEF-123");
  });

  it("accepte un code encodé tel que l'affiche l'imprime (encodeURIComponent)", () => {
    expect(retourValide("/scan?c=a%2Bb")).toBe("/scan?c=a%2Bb");
  });

  it("refuse une adresse sans schéma (« //exemple.com » = autre site pour le navigateur)", () => {
    expect(retourValide("//exemple.com")).toBeNull();
    expect(retourValide("//exemple.com/scan?c=x")).toBeNull();
  });

  it("refuse « /scan@exemple.com » (ce n'est pas le chemin /scan)", () => {
    expect(retourValide("/scan@exemple.com")).toBeNull();
    expect(retourValide("/scan@exemple.com?c=x")).toBeNull();
  });

  it("refuse une URL absolue, même vers un chemin /scan", () => {
    expect(retourValide("https://exemple.com/scan?c=x")).toBeNull();
    expect(retourValide("https://rh.patesenfolie.cd/scan?c=x")).toBeNull();
    expect(retourValide("javascript:alert(1)")).toBeNull();
  });

  it("refuse un chemin encodé (jamais décodé puis réinterprété)", () => {
    expect(retourValide("%2Fscan%3Fc%3Dx")).toBeNull();
    expect(retourValide("/scan%3Fc=x")).toBeNull();
    expect(retourValide("%2F%2Fexemple.com")).toBeNull();
  });

  it("refuse les autres chemins de l'application", () => {
    expect(retourValide("/paie")).toBeNull();
    expect(retourValide("/scanner?c=x")).toBeNull();
    expect(retourValide("/scan/../paie?c=x")).toBeNull();
    expect(retourValide("/scan")).toBeNull(); // sans code, il n'y a rien à reprendre
  });

  it("refuse la barre oblique inverse et les caractères de contrôle (« /\\ » = « // » pour certains navigateurs)", () => {
    expect(retourValide("/scan?c=x\\@exemple.com")).toBeNull();
    expect(retourValide("/\\exemple.com")).toBeNull();
    expect(retourValide("/scan?c=x\r\nLocation: https://exemple.com")).toBeNull();
    expect(retourValide("/scan?c=x y")).toBeNull();
  });

  it("refuse ce qui n'est pas une chaîne, et une chaîne démesurée", () => {
    expect(retourValide(undefined)).toBeNull();
    expect(retourValide(null)).toBeNull();
    expect(retourValide(["/scan?c=x"])).toBeNull();
    expect(retourValide(`/scan?c=${"a".repeat(600)}`)).toBeNull();
  });
});

describe("retourPourChemin : ce que le garde d'authentification mémorise", () => {
  it("mémorise le scan de l'affiche, code compris", () => {
    expect(retourPourChemin("/scan", "?c=abc")).toBe("/scan?c=abc");
  });

  it("ne mémorise rien pour les autres pages", () => {
    expect(retourPourChemin("/paie", "?mois=9")).toBeNull();
    expect(retourPourChemin("/espace/pointer", "")).toBeNull();
    expect(retourPourChemin("/scan", "")).toBeNull();
  });
});

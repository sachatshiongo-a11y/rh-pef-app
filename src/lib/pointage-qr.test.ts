import { describe, it, expect } from "vitest";
import {
  distanceMetres, verdictPosition, urlAffiche, lireCodeDepuisQr,
  coordonneesSaisissables, lireCoordonneesSaisies, libelleMotif, resumePointagesSemaine, scanAVerifier,
} from "./pointage-qr";
import { codesEgaux, genererCodeAffiche } from "./pointage-code";

const RESTO = { lat: -4.3217, lng: 15.3125 };

describe("distanceMetres", () => {
  it("vaut 0 au même point", () => expect(distanceMetres(RESTO, RESTO)).toBe(0));
  it("≈ 111 km pour un degré de latitude", () =>
    expect(distanceMetres({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(111_195, -2));
});

describe("verdictPosition", () => {
  it("au restaurant quand la distance tient dans le rayon", () =>
    expect(verdictPosition({ ...RESTO, precisionM: 20 }, RESTO, 150).verdict).toBe("AU_RESTAURANT"));
  it("bénéfice du doute : distance ≤ rayon + précision", () => {
    // ≈ 200 m au nord, précision 60 m, rayon 150 → 200 ≤ 210
    const p = { lat: RESTO.lat + 0.0018, lng: RESTO.lng, precisionM: 60 };
    expect(verdictPosition(p, RESTO, 150).verdict).toBe("AU_RESTAURANT");
  });
  it("loin au-delà de rayon + précision", () => {
    const v = verdictPosition({ lat: RESTO.lat + 0.02, lng: RESTO.lng, precisionM: 30 }, RESTO, 150);
    expect(v).toMatchObject({ verdict: "A_VERIFIER", motif: "LOIN" });
  });
  it("précision au-delà du plafond → précision insuffisante, même au centre", () =>
    expect(verdictPosition({ ...RESTO, precisionM: 301 }, RESTO, 150))
      .toMatchObject({ verdict: "A_VERIFIER", motif: "PRECISION_INSUFFISANTE" }));
  it("précision exactement au plafond reste exploitable", () =>
    expect(verdictPosition({ ...RESTO, precisionM: 300 }, RESTO, 150).verdict).toBe("AU_RESTAURANT"));
  it("position refusée / indisponible → à vérifier, sans distance", () => {
    expect(verdictPosition({ erreur: "REFUSEE" }, RESTO, 150)).toEqual({ verdict: "A_VERIFIER", motif: "POSITION_REFUSEE", distanceM: null });
    expect(verdictPosition({ erreur: "INDISPONIBLE" }, RESTO, 150)).toEqual({ verdict: "A_VERIFIER", motif: "POSITION_INDISPONIBLE", distanceM: null });
  });
});

describe("code d'affiche", () => {
  it("génère des codes distincts, sûrs dans une URL", () => {
    const a = genererCodeAffiche(), b = genererCodeAffiche();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
  it("compare en temps constant, faux si différents ou de longueurs différentes", () => {
    expect(codesEgaux("abc", "abc")).toBe(true);
    expect(codesEgaux("abc", "abd")).toBe(false);
    expect(codesEgaux("abc", "abcd")).toBe(false);
  });
});

describe("lecture du QR", () => {
  const O = "https://rh.patesenfolie.cd";
  it("relit le code de sa propre affiche", () =>
    expect(lireCodeDepuisQr(urlAffiche(O, "XyZ_-9"), [O])).toBe("XyZ_-9"));
  it("accepte chacune des origines de la liste", () => {
    const R = "https://rh-pef.onrender.com";
    expect(lireCodeDepuisQr(urlAffiche(O, "XyZ"), [R, O])).toBe("XyZ");
    expect(lireCodeDepuisQr(urlAffiche(R, "XyZ"), [R, O])).toBe("XyZ");
  });
  it("refuse une autre origine, un autre chemin, un texte quelconque", () => {
    expect(lireCodeDepuisQr("https://exemple.com/scan?c=XyZ", [O])).toBeNull();
    expect(lireCodeDepuisQr(`${O}/autre?c=XyZ`, [O])).toBeNull();
    expect(lireCodeDepuisQr(`${O}/scan`, [O])).toBeNull();
    expect(lireCodeDepuisQr("bonjour", [O])).toBeNull();
    expect(lireCodeDepuisQr(urlAffiche(O, "XyZ"), [])).toBeNull();
  });
});

describe("coordonnées saisies", () => {
  it("lit le format copié depuis Google Maps", () =>
    expect(lireCoordonneesSaisies("-4.3217, 15.3125")).toEqual({ lat: -4.3217, lng: 15.3125 }));
  it("refuse hors bornes ou illisible", () => {
    expect(lireCoordonneesSaisies("95, 15")).toBeNull();
    expect(lireCoordonneesSaisies("-4.3, 190")).toBeNull();
    expect(lireCoordonneesSaisies("Kinshasa")).toBeNull();
  });
});

describe("coordonneesSaisissables : l'affichage se recopie dans le champ", () => {
  it("point décimal, virgule entre latitude et longitude", () => {
    expect(coordonneesSaisissables(-4.3217, 15.3125)).toBe("-4.3217, 15.3125");
    expect(coordonneesSaisissables(-4.321712, 15.312543)).toBe("-4.321712, 15.312543");
  });
  it("jamais la virgule décimale française, six décimales au plus, sans zéros de fin", () => {
    expect(coordonneesSaisissables(-4.3217, 15.3125)).not.toMatch(/\d,\d/);
    expect(coordonneesSaisissables(-4.32171249, 15)).toBe("-4.321712, 15");
  });
  it("ce qui est affiché se relit à l'identique par le champ de saisie", () => {
    for (const [lat, lng] of [[-4.3217, 15.3125], [-4.321712, 15.312543], [0.5, -0.25], [-90, 180]]) {
      expect(lireCoordonneesSaisies(coordonneesSaisissables(lat, lng))).toEqual({ lat, lng });
    }
  });
});

describe("libellés et résumé", () => {
  it("dit la distance en km au-delà de 1 000 m", () =>
    expect(libelleMotif({ verdict: "A_VERIFIER", motif: "LOIN", distanceM: 2300 })).toBe("à 2,3 km"));
  it("dit la distance en m en deçà", () =>
    expect(libelleMotif({ verdict: "A_VERIFIER", motif: "LOIN", distanceM: 480 })).toBe("à 480 m"));
  it("nomme les autres motifs", () => {
    expect(libelleMotif({ verdict: "A_VERIFIER", motif: "POSITION_REFUSEE", distanceM: null })).toBe("position refusée");
    expect(libelleMotif({ verdict: "A_VERIFIER", motif: "POSITION_INDISPONIBLE", distanceM: null })).toBe("position indisponible");
  });
  it("précision insuffisante porte le ± en mètres", () =>
    expect(libelleMotif({ verdict: "A_VERIFIER", motif: "PRECISION_INSUFFISANTE", distanceM: null, precisionM: 900 })).toBe("précision ±900 m"));
});

describe("resumePointagesSemaine — par POINTAGE, jamais par scan", () => {
  it("un pointage compte pour UN, même avec deux scans (arrivée + départ)", () => {
    // A : arrivée + départ, tous deux à vérifier. B : arrivée seule, à vérifier. C : arrivée +
    // départ, tous deux au restaurant. Compter par scan donnerait 3 sur 5 (60 %) ; par pointage,
    // 2 pointages sur 3 n'ont pas confirmé la présence (67 %) — l'exemple de la relecture.
    const A: { verdicts: ("AU_RESTAURANT" | "A_VERIFIER")[] } = { verdicts: ["A_VERIFIER", "A_VERIFIER"] };
    const B: { verdicts: ("AU_RESTAURANT" | "A_VERIFIER")[] } = { verdicts: ["A_VERIFIER"] };
    const C: { verdicts: ("AU_RESTAURANT" | "A_VERIFIER")[] } = { verdicts: ["AU_RESTAURANT", "AU_RESTAURANT"] };
    expect(resumePointagesSemaine([A, B, C])).toEqual({ total: 3, horsRestaurant: 2, pourcent: 67 });
  });
  it("un seul scan A_VERIFIER sur un pointage suffit à le compter hors restaurant", () =>
    expect(resumePointagesSemaine([{ verdicts: ["AU_RESTAURANT", "A_VERIFIER"] }]))
      .toEqual({ total: 1, horsRestaurant: 1, pourcent: 100 }));
  it("aucun pointage : 0 %, jamais NaN", () =>
    expect(resumePointagesSemaine([])).toEqual({ total: 0, horsRestaurant: 0, pourcent: 0 }));
});

describe("scanAVerifier — le badge « À vérifier » du Suivi", () => {
  it("trouve le scan A_VERIFIER pas encore vérifié, du bon moment", () => {
    const scans = [
      { moment: "ARRIVEE" as const, verdict: "A_VERIFIER" as const, verifieLe: null },
      { moment: "DEPART" as const, verdict: "AU_RESTAURANT" as const, verifieLe: null },
    ];
    expect(scanAVerifier(scans, "ARRIVEE")).toBe(scans[0]);
    expect(scanAVerifier(scans, "DEPART")).toBeUndefined(); // AU_RESTAURANT : rien à vérifier
  });
  it("ignore un scan A_VERIFIER déjà vérifié (`verifieLe` posé)", () => {
    const scans = [{ moment: "ARRIVEE" as const, verdict: "A_VERIFIER" as const, verifieLe: new Date() }];
    expect(scanAVerifier(scans, "ARRIVEE")).toBeUndefined();
  });
  it("aucun scan de ce moment → undefined", () => {
    expect(scanAVerifier([], "DEPART")).toBeUndefined();
  });
});

import { describe, it, expect } from "vitest";
import {
  nomsProches, memeNom, motifsDoublon, fichesProches, doublonsProbables, identiteModifiee, cleTelephone,
  jourNaissance, clePaire, pairesEcartees, lireIdsEcartes, messageDoublons,
} from "./employe-doublon";

describe("noms de personnes proches", () => {
  it.each([
    ["Sacha Tshiongo", "Sacha Tshiongo", "identique"],
    ["Tshiongo Sacha", "Sacha Tshiongo", "ordre des mots"],
    ["SACHA  tshiongo", "Sacha Tshiongo", "casse et espaces"],
    ["Aimée Mutita", "Aimee Mutita", "accents"],
    ["Jean-Pierre Kabila", "Jean Pierre Kabila", "tiret"],
    ["Kabila Jean-Pierre", "Jean Pierre Kabila", "tiret et ordre"],
    ["Tshiongo", "Sacha Tshiongo", "prénom manquant"],
    ["Sacha", "Sacha Tshiongo", "nom manquant"],
    ["Marie Kabila", "Marie-Claire Kabila", "mot de trop"],
    ["Sacha Tshiyongo", "Sacha Tshiongo", "une faute de frappe"],
    ["J. Kabila", "Jean Kabila", "initiale"],
    ["Mbuyikabedi", "Mbuyi Kabedi", "espace oublié"],
    ["César (jardinier)", "César", "précision entre parenthèses"],
  ])("« %s » ≈ « %s » (%s)", (a, b) => {
    expect(nomsProches(a, b)).toBe(true);
    expect(nomsProches(b, a)).toBe(true);
  });

  it.each([
    ["Sacha Tshiongo", "Sacha Mukendi", "même prénom seulement"],
    ["Esther Nsundi", "Aimée Mutita", "rien en commun"],
    ["Jean Kabila", "Jeanne Kabamba", "deux mots différents"],
    ["An", "Jean", "sous-chaîne, pas un mot"],
    ["Sa", "Sacha Tshiongo", "début de saisie"],
    ["J.", "Jean Kabila", "une initiale seule ne prouve rien"],
    ["", "Sacha Tshiongo", "vide"],
    ["Tshiongo Sacha", "Tshiongo Samuel", "même nom de famille, autre prénom"],
    ["Ali Kasongo", "Alia Kasongo", "même nombre de mots : pas de rapprochement par lettres collées"],
  ])("« %s » ≠ « %s » (%s)", (a, b) => {
    expect(nomsProches(a, b)).toBe(false);
    expect(nomsProches(b, a)).toBe(false);
  });

  it("même nom exact = mêmes mots, quel que soit l'ordre ; un mot manquant n'est pas le même nom", () => {
    expect(memeNom("Tshiongo  SACHA", "Sacha Tshiongo")).toBe(true);
    expect(memeNom("Tshiongo", "Sacha Tshiongo")).toBe(false);
    expect(memeNom("", "")).toBe(false);
  });
});

describe("téléphone et date de naissance", () => {
  it("le téléphone se compare sur ses 9 derniers chiffres (indicatif, zéro, espaces)", () => {
    expect(cleTelephone("+243 81 234 5678")).toBe(cleTelephone("0812345678"));
    expect(cleTelephone("00243-812-345-678")).toBe("812345678");
    expect(cleTelephone("12 34")).toBeNull();
    expect(cleTelephone(null)).toBeNull();
    // Numéros de remplissage : deux fiches sans vrai numéro ne sont pas la même personne.
    expect(cleTelephone("0000000000")).toBeNull();
    expect(cleTelephone("+243 999 999 999")).toBeNull();
  });

  it("même téléphone, noms sans rapport : signalé (motif téléphone seul)", () => {
    expect(motifsDoublon({ nom: "Jean Kabila", telephone: "+243 99 111 2233" }, { nom: "Papa Jean", telephone: "0991112233" })).toEqual(["telephone"]);
  });

  it("même date de naissance + un mot commun : signalé (nom d'épouse) ; sans mot commun : non", () => {
    const d = new Date("1990-04-12T00:00:00Z");
    expect(motifsDoublon({ nom: "Marie Kabila", dateNaissance: "1990-04-12" }, { nom: "Marie Mukendi", dateNaissance: d })).toEqual(["naissance"]);
    expect(motifsDoublon({ nom: "Esther Nsundi", dateNaissance: "1990-04-12" }, { nom: "Marie Mukendi", dateNaissance: d })).toEqual([]);
    expect(motifsDoublon({ nom: "Marie Kabila", dateNaissance: "1990-04-13" }, { nom: "Marie Mukendi", dateNaissance: d })).toEqual([]);
  });

  it("jour de naissance lu en UTC (colonne DATE) ou depuis la saisie AAAA-MM-JJ", () => {
    expect(jourNaissance(new Date("1990-04-12T00:00:00Z"))).toBe("1990-04-12");
    expect(jourNaissance("1990-04-12")).toBe("1990-04-12");
    expect(jourNaissance("")).toBeNull();
    expect(jourNaissance(new Date("x"))).toBeNull();
  });

  it("tous les motifs se cumulent", () => {
    expect(motifsDoublon(
      { nom: "Tshiongo Sacha", telephone: "0812345678", dateNaissance: "1990-04-12" },
      { nom: "Sacha Tshiongo", telephone: "+243812345678", dateNaissance: new Date("1990-04-12T00:00:00Z") },
    )).toEqual(["nom", "telephone", "naissance"]);
  });
});

const FICHES = [
  { id: "a", nom: "Sacha Tshiongo", telephone: "0812345678", dateNaissance: null, actif: true },
  { id: "b", nom: "Martine Mutombo", telephone: null, dateNaissance: null, actif: false },
  { id: "c", nom: "Sacha Mukendi", telephone: null, dateNaissance: null, actif: true },
  { id: "d", nom: "Tshiongo", telephone: null, dateNaissance: null, actif: true },
];

describe("fiches proches d'une saisie", () => {
  it("trouve les fiches actives ET inactives, le même nom exact en tête", () => {
    const r = fichesProches({ nom: "Tshiongo Sacha" }, FICHES);
    expect(r.map((p) => [p.fiche.id, p.memeNom])).toEqual([["a", true], ["d", false]]);
    expect(fichesProches({ nom: "Mutombo Martine" }, FICHES).map((p) => p.fiche.id)).toEqual(["b"]);
  });

  it("rien de proche : liste vide (un homonyme de prénom n'en est pas un)", () => {
    expect(fichesProches({ nom: "Sacha Kalala" }, FICHES)).toEqual([]);
  });

  it("le téléphone seul suffit à remonter une fiche", () => {
    expect(fichesProches({ nom: "Inconnu Total", telephone: "+243 81 234 56 78" }, FICHES).map((p) => [p.fiche.id, p.motifs])).toEqual([["a", ["telephone"]]]);
  });

  it("modification : la fiche elle-même et les paires déjà écartées sont exclues", () => {
    expect(fichesProches({ nom: "Sacha Tshiongo" }, FICHES, { exclureId: "a" }).map((p) => p.fiche.id)).toEqual(["d"]);
    expect(fichesProches({ nom: "Sacha Tshiongo" }, FICHES, { exclureId: "a", ecartees: new Set([clePaire("d", "a")]) })).toEqual([]);
  });
});

describe("doublons probables déjà en base", () => {
  it("liste chaque paire une fois, hors paires écartées", () => {
    const paires = doublonsProbables(FICHES);
    expect(paires.map((p) => [p.a.id, p.b.id])).toEqual([["a", "d"]]);
    expect(doublonsProbables(FICHES, new Set([clePaire("a", "d")]))).toEqual([]);
  });

  it("les paires écartées se lisent au journal (une fiche → plusieurs ids)", () => {
    const p = pairesEcartees([{ entiteId: "a", nouvelleValeur: "d, c" }, { entiteId: "x", nouvelleValeur: null }, { entiteId: "y", nouvelleValeur: "y" }]);
    expect([...p].sort()).toEqual([clePaire("a", "c"), clePaire("a", "d")].sort());
    expect([...lireIdsEcartes(" a,,b ")]).toEqual(["a", "b"]);
  });
});

describe("modification : la question ne se repose que si l'identité change", () => {
  const avant = { nom: "Sacha Tshiongo", telephone: "0812345678", dateNaissance: new Date("1990-04-12T00:00:00Z") };
  it("même identité (casse, ordre, écriture du téléphone) : non modifiée", () => {
    expect(identiteModifiee(avant, { nom: "tshiongo SACHA", telephone: "+243 812 345 678", dateNaissance: "1990-04-12" })).toBe(false);
  });
  it.each([
    [{ nom: "Sacha Tshiongo Kabila" }],
    [{ telephone: "0999999999" }],
    [{ dateNaissance: "1991-04-12" }],
    [{ telephone: null }],
  ])("%o : modifiée", (changement) => {
    expect(identiteModifiee(avant, { ...avant, ...changement })).toBe(true);
  });
});

it("message de refus lisible : noms, statut inactif, motifs, et les trois issues", () => {
  const m = messageDoublons(fichesProches({ nom: "Mutombo Martine" }, FICHES));
  expect(m).toContain("« Martine Mutombo » (inactive) — même nom");
  expect(m).toMatch(/Ouvrez la fiche existante.*réactivez-la.*C'est une autre personne/);
});

it("la liste des doublons probables reste rapide à l'échelle (identités préparées une fois)", () => {
  const prenoms = ["Aimée", "Esther", "Jean", "Marie", "Paul", "Rose", "Marc", "Zoé", "Gode", "César", "Léa", "Nathan", "Grâce", "Pierre", "Joseph"];
  const noms = ["Mutita", "Nsundi", "Kabila", "Mbuyi", "Ilunga", "Tshibangu", "Kasongo", "Mukendi", "Kalala", "Bokole", "Kabeya", "Lukusa", "Ngoy", "Mwamba", "Tshiongo", "Banza", "Kanku", "Mulumba", "Kayembe", "Lumbu"];
  const fiches = Array.from({ length: 300 }, (_, i) => ({ id: `e${i}`, nom: `${prenoms[i % 15]} ${noms[Math.floor(i / 15)]}`, telephone: `08${String(10000000 + i * 7)}`, dateNaissance: null }));
  const t = performance.now();
  doublonsProbables(fiches);
  // 300 fiches = 44 850 paires. Mesuré ~0,3 s sur la machine chargée ; avant la préparation, plusieurs secondes.
  expect(performance.now() - t).toBeLessThan(3000);
});

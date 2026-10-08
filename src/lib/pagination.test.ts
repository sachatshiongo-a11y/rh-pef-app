import { describe, it, expect } from "vitest";
import {
  PLAFOND_TOUT, appliquerPagination, compteurPage, fenetrePage, hrefPagination, lireNumeroPage, lireParPage, lirePagination,
  groupePartiel, numerosPages, pageApresChangementTaille, paramsSansPage, tranche,
} from "./pagination";

describe("lecture de l'URL", () => {
  it("par : 50 par défaut, 100 et « tout » reconnus, le reste = 50", () => {
    expect(lireParPage(undefined)).toBe(50);
    expect(lireParPage("100")).toBe(100);
    expect(lireParPage("tout")).toBe("tout");
    for (const v of ["25", "0", "-1", "abc", "", ["x"]]) expect(lireParPage(v)).toBe(50);
    expect(lireParPage(["100", "tout"])).toBe(100);
  });
  it("page : entier ≥ 1, sinon 1", () => {
    expect(lireNumeroPage("3")).toBe(3);
    for (const v of [undefined, "0", "-2", "1.5", "abc", "", "99999999999"]) expect(lireNumeroPage(v)).toBe(1);
    expect(lirePagination({ page: "2", par: "100" })).toEqual({ page: 2, par: 100 });
  });
});

describe("fenetrePage", () => {
  it("342 lignes, 50 par page : 7 pages, la page 2 = 51–100", () => {
    const f = fenetrePage(342, 2, 50);
    expect(f).toMatchObject({ page: 2, nbPages: 7, de: 51, a: 100, debut: 50, fin: 100, skip: 50, take: 50 });
    expect(compteurPage(f)).toBe("51–100 sur 342");
  });
  it("dernière page partielle : 301–342", () => {
    const f = fenetrePage(342, 7, 50);
    expect(compteurPage(f)).toBe("301–342 sur 342");
  });
  it("page demandée hors limites : ramenée à la dernière (jamais une page vide)", () => {
    expect(fenetrePage(342, 99, 50).page).toBe(7);
    expect(fenetrePage(0, 5, 50)).toMatchObject({ page: 1, nbPages: 1, de: 0, a: 0, skip: 0 });
  });
  it("« tout » : une seule page, pas de take", () => {
    const f = fenetrePage(342, 4, "tout");
    expect(f).toMatchObject({ page: 1, nbPages: 1, de: 1, a: 342, skip: 0, take: undefined });
    expect(compteurPage(f)).toBe("1–342 sur 342");
  });
  it("compteur : vide et une seule ligne", () => {
    expect(compteurPage(fenetrePage(0, 1, 50))).toBe("0");
    expect(compteurPage(fenetrePage(1, 1, 50))).toBe("1 sur 1");
  });
  it("tranche : exactement les lignes de la page", () => {
    const l = Array.from({ length: 120 }, (_, i) => i);
    expect(tranche(l, fenetrePage(120, 3, 50))).toEqual(l.slice(100));
    expect(tranche(l, fenetrePage(120, 1, "tout"))).toHaveLength(120);
  });
});

describe("taille et numéros", () => {
  it("changer la taille garde la première ligne à l'écran", () => {
    expect(pageApresChangementTaille(100, 100)).toBe(2); // 101e ligne : page 2 de 100
    expect(pageApresChangementTaille(150, 50)).toBe(4);
    expect(pageApresChangementTaille(150, "tout")).toBe(1);
  });
  it("numéros : bornes, voisines et « … »", () => {
    expect(numerosPages(1, 3)).toEqual([1, 2, 3]);
    expect(numerosPages(1, 10)).toEqual([1, 2, "…", 10]);
    expect(numerosPages(5, 10)).toEqual([1, "…", 4, 5, 6, "…", 10]);
    expect(numerosPages(4, 10)).toEqual([1, 2, 3, 4, 5, "…", 10]);
    expect(numerosPages(10, 10)).toEqual([1, "…", 9, 10]);
  });
});

describe("adresses", () => {
  it("les valeurs par défaut s'effacent, le reste est conservé", () => {
    expect(hrefPagination("/stock/catalogue", { q: "farine", domaine: "BOISSON" }, 1, 50)).toBe("/stock/catalogue?q=farine&domaine=BOISSON");
    expect(hrefPagination("/stock/catalogue", { q: "farine" }, 3, 100)).toBe("/stock/catalogue?q=farine&page=3&par=100");
    expect(hrefPagination("/x", {}, 1, 50)).toBe("/x");
    expect(hrefPagination("/x", { page: "9", par: "tout" }, 2, "tout")).toBe("/x?page=2&par=tout");
  });
  it("appliquerPagination ne touche pas aux autres paramètres", () => {
    const p = appliquerPagination(new URLSearchParams("q=a&page=4&par=100"), 1, 50);
    expect(p.toString()).toBe("q=a");
  });
  it("paramsSansPage : change de filtre = retour à la page 1, la taille reste", () => {
    expect(paramsSansPage({ q: "a", page: "4", par: "100", x: undefined }).toString()).toBe("q=a&par=100");
  });
});

describe("groupePartiel — mois coupés par une frontière de page", () => {
  it("le premier groupe (page > 1) et le dernier (page < dernière) sont partiels ; ceux du milieu non", () => {
    const f = { page: 2, nbPages: 3 };
    expect(groupePartiel(0, 4, f)).toBe(true);
    expect(groupePartiel(1, 4, f)).toBe(false);
    expect(groupePartiel(3, 4, f)).toBe(true);
  });
  it("page unique : jamais partiel ; première page : seul le dernier ; dernière page : seul le premier", () => {
    expect(groupePartiel(0, 2, { page: 1, nbPages: 1 })).toBe(false);
    expect(groupePartiel(0, 2, { page: 1, nbPages: 3 })).toBe(false);
    expect(groupePartiel(1, 2, { page: 1, nbPages: 3 })).toBe(true);
    expect(groupePartiel(0, 2, { page: 3, nbPages: 3 })).toBe(true);
    expect(groupePartiel(1, 2, { page: 3, nbPages: 3 })).toBe(false);
  });
});

describe("« Tout » borné sur une page serveur", () => {
  it("sous le plafond : tout, sans mention", () => {
    const f = fenetrePage(1500, 1, "tout", PLAFOND_TOUT);
    expect(f).toMatchObject({ tronque: false, take: undefined, a: 1500 });
  });
  it("au-delà : les 2000 premières lignes seulement, une seule page, et le dit", () => {
    const f = fenetrePage(2500, 3, "tout", PLAFOND_TOUT);
    expect(f).toMatchObject({ tronque: true, take: 2000, skip: 0, de: 1, a: 2000, nbPages: 1, page: 1 });
    expect(compteurPage(f)).toBe("1–2000 sur 2500");
  });
  it("sans plafond demandé (tableau déjà chargé) : jamais tronqué ; 50 / 100 non concernés", () => {
    expect(fenetrePage(5000, 1, "tout").tronque).toBe(false);
    expect(fenetrePage(5000, 1, 100, PLAFOND_TOUT).tronque).toBe(false);
  });
});

// L'export d'une SÉLECTION d'employés (`?ids=`) : mêmes colonnes, restreint aux cochés ; au-delà du plafond, refus lisible.
import { describe, it, expect } from "vitest";
import type { Employee } from "@prisma/client";
import { filtrerEmployes, idsSelectionEmployes, refusSelectionTropGrande, MAX_EXPORT_EMPLOYES } from "./_donnees";

const e = (id: string, nom: string, categorie = "BRIGADE") => ({ id, nom, matricule: id.toUpperCase(), poste: "Cuisinier", secteur: "Cuisine", categorie, dateEmbauche: new Date("2024-01-10") }) as unknown as Employee;
const TOUS = [e("a", "Zoé"), e("b", "Aimée"), e("c", "Paul", "BACKOFFICE")];
const qs = (s: string) => new URLSearchParams(s);

describe("filtrerEmployes — sélection", () => {
  it("sans ids : tout, Brigade puis Back-office", () => {
    expect(filtrerEmployes(TOUS, qs("")).map((x) => x.id)).toEqual(["b", "a", "c"]);
  });
  it("avec ids : seulement les cochés, dans le même ordre", () => {
    expect(filtrerEmployes(TOUS, qs("ids=c,a")).map((x) => x.id)).toEqual(["a", "c"]);
  });
  it("une sélection vide n'exporte RIEN (jamais toute la liste)", () => {
    expect(filtrerEmployes(TOUS, qs("ids=")).map((x) => x.id)).toEqual([]);
  });
  it("les autres filtres s'appliquent encore", () => {
    expect(filtrerEmployes(TOUS, qs("ids=a,c&q=paul")).map((x) => x.id)).toEqual(["c"]);
  });
  it("lecture des ids : doublons et blancs écartés", () => {
    expect(idsSelectionEmployes(qs("ids=a, b,,a"))).toEqual(["a", "b"]);
    expect(idsSelectionEmployes(qs("statut=tous"))).toBeNull();
  });
});

describe("plafond de l'export d'une sélection", () => {
  it("au-delà : 400 lisible, jamais une liste tronquée", async () => {
    const ids = Array.from({ length: MAX_EXPORT_EMPLOYES + 1 }, (_, i) => `x${i}`).join(",");
    const r = refusSelectionTropGrande(qs(`ids=${ids}`));
    expect(r?.status).toBe(400);
    expect(await r!.text()).toBe(`Exportez ${MAX_EXPORT_EMPLOYES} employés au plus à la fois.`);
  });
  it("jusqu'au plafond : accepté", () => {
    const ids = Array.from({ length: MAX_EXPORT_EMPLOYES }, (_, i) => `x${i}`).join(",");
    expect(refusSelectionTropGrande(qs(`ids=${ids}`))).toBeNull();
    expect(refusSelectionTropGrande(qs(""))).toBeNull();
  });
});

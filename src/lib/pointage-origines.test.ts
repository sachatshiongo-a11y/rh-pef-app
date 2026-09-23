import { describe, it, expect, vi, afterEach } from "vitest";
import { urlAffiche, lireCodeDepuisQr } from "./pointage-qr";

// L'application répond sur DEUX adresses en production. Un salarié a pu l'installer depuis l'une
// ou l'autre ; l'affiche, elle, n'en porte qu'une. Le scanner doit donc accepter l'origine où il
// tourne ET l'origine de l'affiche — et rien d'autre.
const OFFICIELLE = "https://rh.patesenfolie.cd";
const RENDER = "https://rh-pef.onrender.com";

async function chargerOrigines() {
  vi.resetModules();
  return import("./pointage-origines");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("ORIGINE_AFFICHE", () => {
  it("vaut l'adresse officielle quand rien n'est configuré", async () => {
    vi.stubEnv("NEXT_PUBLIC_ORIGINE_AFFICHE", "");
    const { ORIGINE_AFFICHE } = await chargerOrigines();
    expect(ORIGINE_AFFICHE).toBe(OFFICIELLE);
  });

  it("reprend la variable d'environnement, réduite à son origine", async () => {
    vi.stubEnv("NEXT_PUBLIC_ORIGINE_AFFICHE", "https://essai.exemple.cd/");
    const { ORIGINE_AFFICHE } = await chargerOrigines();
    expect(ORIGINE_AFFICHE).toBe("https://essai.exemple.cd");
  });

  it("une variable illisible retombe sur l'adresse officielle", async () => {
    vi.stubEnv("NEXT_PUBLIC_ORIGINE_AFFICHE", "pas une adresse");
    const { ORIGINE_AFFICHE } = await chargerOrigines();
    expect(ORIGINE_AFFICHE).toBe(OFFICIELLE);
  });
});

describe("originesAcceptees", () => {
  it("l'origine courante et celle de l'affiche, sans doublon", async () => {
    vi.stubEnv("NEXT_PUBLIC_ORIGINE_AFFICHE", "");
    const { originesAcceptees } = await chargerOrigines();
    expect(originesAcceptees(RENDER)).toEqual([RENDER, OFFICIELLE]);
    expect(originesAcceptees(OFFICIELLE)).toEqual([OFFICIELLE]);
  });

  it("le QR officiel lu depuis l'adresse Render est accepté", async () => {
    vi.stubEnv("NEXT_PUBLIC_ORIGINE_AFFICHE", "");
    const { ORIGINE_AFFICHE, originesAcceptees } = await chargerOrigines();
    const qr = urlAffiche(ORIGINE_AFFICHE, "XyZ_-9");
    expect(lireCodeDepuisQr(qr, originesAcceptees(RENDER))).toBe("XyZ_-9");
    expect(lireCodeDepuisQr(qr, originesAcceptees(OFFICIELLE))).toBe("XyZ_-9");
  });

  it("le QR d'une origine tierce est refusé, d'où qu'on le lise", async () => {
    vi.stubEnv("NEXT_PUBLIC_ORIGINE_AFFICHE", "");
    const { originesAcceptees } = await chargerOrigines();
    const tiers = urlAffiche("https://rh-pef.exemple.com", "XyZ_-9");
    expect(lireCodeDepuisQr(tiers, originesAcceptees(RENDER))).toBeNull();
    expect(lireCodeDepuisQr(tiers, originesAcceptees(OFFICIELLE))).toBeNull();
    // Même hôte, autre schéma : une autre origine.
    expect(lireCodeDepuisQr(urlAffiche("http://rh.patesenfolie.cd", "XyZ_-9"), originesAcceptees(RENDER))).toBeNull();
  });
});

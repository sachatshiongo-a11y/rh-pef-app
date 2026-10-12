// Garde-fou (audit du 10/10/2026, ergonomie 5 et 13) : chaque espace a son écran d'attente (loading.tsx),
// chaque espace a son écran d'erreur récupérable (error.tsx : « Réessayer » plutôt que « This page couldn't load »),
// et la 404 est en français.
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { renderToString } from "react-dom/server";
import { createElement as h } from "react";
import { ChargementPage } from "@/components/chargement-page";

const app = (rel: string) => path.resolve(__dirname, rel);

describe("pages système de chaque espace", () => {
  for (const espace of ["(app)", "(stock)", "(exploitation)"]) {
    it(`${espace} : loading.tsx qui rend ChargementPage`, () => {
      expect(existsSync(app(`${espace}/loading.tsx`))).toBe(true);
      expect(readFileSync(app(`${espace}/loading.tsx`), "utf8")).toContain("ChargementPage");
    });
  }
  for (const [dossier, accueil] of [["(app)", "/accueil"], ["(stock)", "/stock"], ["(exploitation)", "/exploitation"], ["espace", "/espace"], ["login", "/login"], ["scan", "/entree"]] as const) {
    it(`${dossier} : error.tsx avec Réessayer et retour ${accueil}`, () => {
      const f = app(`${dossier}/error.tsx`);
      expect(existsSync(f)).toBe(true);
      const source = readFileSync(f, "utf8");
      expect(source).toContain("ErrorRetry");
      expect(source).toContain(`accueilHref="${accueil}"`);
    });
  }
  it("la 404 est en français et ramène à l'espace de la personne", () => {
    const source = readFileSync(app("not-found.tsx"), "utf8");
    expect(source).toContain("Page introuvable");
    expect(source).toContain('href="/entree"');
  });
  it("l'écran d'attente est annoncé aux lecteurs d'écran et ne porte aucune donnée", () => {
    const html = renderToString(h(ChargementPage));
    expect(html).toContain('role="status"');
    expect(html).toContain("Chargement");
  });
});

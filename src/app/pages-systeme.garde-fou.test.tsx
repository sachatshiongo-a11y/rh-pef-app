// Garde-fou (audit du 10/10/2026, ergonomie 5 et 13) : chaque espace a son écran d'attente (loading.tsx),
// chaque espace a son écran d'erreur récupérable (error.tsx : « Réessayer » plutôt que « This page couldn't load »),
// et la 404 est en français.
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { renderToString } from "react-dom/server";
import { createElement as h } from "react";
import { ChargementPage } from "@/components/chargement-page";

const app = (rel: string) => path.resolve(__dirname, rel);

describe("pages système de chaque espace", () => {
  for (const espace of ["(app)", "(stock)", "(exploitation)", "(stock)/stock", "(exploitation)/exploitation"]) {
    it(`${espace} : loading.tsx qui rend ChargementPage`, () => {
      expect(existsSync(app(`${espace}/loading.tsx`))).toBe(true);
      expect(readFileSync(app(`${espace}/loading.tsx`), "utf8")).toContain("ChargementPage");
    });
  }
  // Un loading.tsx n'enveloppe que les ENFANTS DIRECTS de son dossier (Next 16 : l'écran d'attente d'un
  // segment est celui de son PARENT, remis à zéro à chaque niveau). Celui de « (stock) » ne couvrait donc que
  // l'ENTRÉE dans l'espace Stock : d'Inventaire à Mouvements, ou d'Employés à une fiche, la page restait figée
  // sans signe jusqu'à la réponse du serveur. Règle : le dossier PARENT de chaque page a son loading.tsx.
  // Exceptions fermées : les pages « Modifier » sous une fiche ([id]) — un loading.tsx dans [id] ferait
  // aussi clignoter la fiche entière à chaque changement d'onglet (?tab=), qui reste sur place comme avant.
  it("chaque page d'un espace a un écran d'attente dans son dossier parent", () => {
    const SANS_ECRAN: Record<string, string> = {
      "(app)/employes/[id]/modifier/page.tsx": "loading.tsx dans [id] = squelette à chaque onglet de la fiche",
      "(stock)/stock/commandes/[id]/modifier/page.tsx": "loading.tsx dans [id] = squelette à chaque paramètre du bon",
    };
    const pages: string[] = [];
    const parcourir = (rel: string) => {
      for (const e of readdirSync(app(rel), { withFileTypes: true })) {
        const r = `${rel}/${e.name}`;
        if (e.isDirectory()) parcourir(r);
        else if (e.name === "page.tsx") pages.push(r);
      }
    };
    for (const espace of ["(app)", "(stock)", "(exploitation)"]) parcourir(espace);
    expect(pages.length).toBeGreaterThan(60);
    const sansEcran = pages.filter((p) => {
      const parent = p.split("/").slice(0, -2).join("/");
      return !existsSync(app(`${parent}/loading.tsx`)) && !SANS_ECRAN[p];
    });
    expect(sansEcran).toEqual([]);
    for (const p of Object.keys(SANS_ECRAN)) expect(existsSync(app(p))).toBe(true); // une exception devenue sans objet est retirée
  });
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

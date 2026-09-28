import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { metadata } from "./layout";

// L'application installée depuis l'espace salarié s'ouvre sur /espace (lot 6). Avant, le seul
// manifeste disait /accueil — l'accueil de la Direction — et le salarié y était renvoyé ailleurs
// par deux redirections, en marquant au passage « rh » comme son dernier espace visité.
// Que ce manifeste réponde SANS session est vérifié par src/lib/chemins-publics.test.ts.
const racine = path.resolve(__dirname, "../../..");

describe("manifeste PWA de l'espace salarié", () => {
  const publie = String(metadata.manifest);
  const fichier = path.join(racine, "public", publie);

  it("le layout de l'espace déclare son propre manifeste, qui existe", () => {
    expect(publie).toBe("/manifest-espace.json");
    expect(existsSync(fichier)).toBe(true);
  });

  it("il s'ouvre sur /espace et ses icônes existent", () => {
    const m = JSON.parse(readFileSync(fichier, "utf8"));
    expect(m.start_url).toBe("/espace");
    expect(m.display).toBe("standalone");
    for (const i of m.icons) expect(existsSync(path.join(racine, "public", i.src)), i.src).toBe(true);
  });
});

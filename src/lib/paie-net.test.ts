import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { salaireNetUSD, salaireNetCDF, totalVerseUSD } from "./paie-net";

// Ligne RÉELLE de la paie de septembre 2026 (Aimée Mutita) : 368,50 versés dont 114,78 de transport.
const aimee = { salNetUSD: 368.5, transportUSD: 114.78 };

describe("paie-net — salaire net = total versé − transport", () => {
  it("salaire net hors transport", () => {
    expect(salaireNetUSD(aimee)).toBeCloseTo(253.72, 2);
  });
  it("total versé = ce qui est remis, transport compris", () => {
    expect(totalVerseUSD(aimee)).toBeCloseTo(368.5, 2);
  });
  it("sans transport, salaire net = total versé", () => {
    expect(salaireNetUSD({ salNetUSD: 164, transportUSD: 0 })).toBe(164);
    expect(totalVerseUSD({ salNetUSD: 164, transportUSD: 0 })).toBe(164);
  });
  it("en CDF, au taux du bulletin", () => {
    expect(salaireNetCDF(aimee, 2800)).toBeCloseTo(253.72 * 2800, 0);
  });
  it("accepte les Decimal de Prisma (objets à toString) et les chaînes", () => {
    const dec = (v: string) => ({ toString: () => v });
    expect(salaireNetUSD({ salNetUSD: dec("368.50"), transportUSD: dec("114.78") })).toBeCloseTo(253.72, 2);
    expect(salaireNetUSD({ salNetUSD: "368.50", transportUSD: "114.78" })).toBeCloseTo(253.72, 2);
  });
  it("un transport supérieur au versé (donnée incohérente) donne un net négatif, jamais NaN", () => {
    expect(salaireNetUSD({ salNetUSD: 10, transportUSD: 25 })).toBe(-15);
  });
});

describe("règle : hors moteur, personne ne lit salNetUSD sans passer par paie-net", () => {
  // Le moteur et le lot de paie PRODUISENT salNetUSD ; tout le reste l'AFFICHE, et doit donc dire
  // lequel des deux nets il montre. Une lecture directe est un « net » qui a échappé à la règle.
  // bulletin-live.ts PRODUIT les lignes d'aperçu (calculerBulletinLive), au même titre que
  // paie-batch.ts produit les lignes stockées — ce n'est pas un affichage.
  // paie-validation.ts n'affiche rien non plus : à la validation, il compare le salNetUSD stocké
  // (total versé) à celui que le moteur produit à nouveau, champ à champ.
  const PRODUCTEURS = new Set([
    "src/lib/payroll.ts",
    "src/lib/paie-batch.ts",
    "src/lib/paie-net.ts",
    "src/lib/bulletin-live.ts",
    "src/lib/paie-validation.ts",
  ]);
  // Un vrai import du module, pas une simple mention (un commentaire qui cite "@/lib/paie-net" ne
  // suffit plus — sinon un fichier peut se contenter de PARLER du module sans jamais l'appeler).
  const IMPORTE_LE_MODULE = /^\s*import\s[^;]*from\s+["']@\/lib\/paie-net["']/m;
  it("tout fichier de src/ qui mentionne salNetUSD importe @/lib/paie-net (ou est producteur)", () => {
    const fautifs: string[] = [];
    const parcourir = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) parcourir(p);
        else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
          const rel = path.relative(process.cwd(), p);
          if (PRODUCTEURS.has(rel)) continue;
          const s = fs.readFileSync(p, "utf8");
          if (s.includes("salNetUSD") && !IMPORTE_LE_MODULE.test(s)) fautifs.push(rel);
        }
      }
    };
    parcourir(path.join(process.cwd(), "src"));
    expect(fautifs, "importer salaireNetUSD/totalVerseUSD de @/lib/paie-net").toEqual([]);
  });
});

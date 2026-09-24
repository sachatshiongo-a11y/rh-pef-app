import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { salaireDeBaseUSD, salaireNetUSD, salaireNetCDF, totalVerseUSD } from "./paie-net";

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

describe("salaireDeBaseUSD — le salaire de base imprimé s'additionne au brut", () => {
  // Ligne RÉELLE figée de septembre 2026 (Gode, back-office) : remuneration100 = 0 stocké avant le
  // 2026-09-24, brut 192,63 $ sans transport. Le bulletin imprimait « Salaire de base 0,00 $ ».
  const gode = { remuneration100: "0.00", remuneration2_3: "0.00", hsValorisee: "0.00", primesUSD: "0.00", transportUSD: "0.00", salBrutUSD: "192.63", salNetUSD: "164.00" };
  it("back-office figé (base 0 stockée) : base = brut − transport − primes − HS − maladie", () => {
    expect(salaireDeBaseUSD(gode, "BACKOFFICE")).toBe(192.63);
    expect(salaireDeBaseUSD({ ...gode, transportUSD: "25.00", salBrutUSD: "52.23", primesUSD: "0.00" }, "BACKOFFICE")).toBe(27.23);
  });
  it("back-office recalculé (base portée par le moteur) : montant stocké", () => {
    expect(salaireDeBaseUSD({ ...gode, remuneration100: "192.63" }, "BACKOFFICE")).toBe(192.63);
  });
  it("brigade : toujours le montant stocké, jamais une différence", () => {
    expect(salaireDeBaseUSD({ ...gode, remuneration100: "0.00", salBrutUSD: "50.00" }, "BRIGADE")).toBe(0);
    expect(salaireDeBaseUSD({ ...gode, remuneration100: "174.88", salBrutUSD: "310.53", transportUSD: "135.65" }, "BRIGADE")).toBe(174.88);
  });
});

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { SOURCES_PAIE, GARDE_RECALCUL_MS, paieAJour, garderRecente, texteEmpreinte, VERSION_EMPREINTE, memesLignesFigees } from "@/lib/paie-empreinte";

// GARDE-FOUS STATIQUES de l'empreinte des sources de la paie (lib/paie-empreinte.ts). Leur rôle : qu'une
// donnée lue un jour par le moteur sans figurer dans l'empreinte fasse échouer la suite, et non
// l'affichage d'une paie périmée devant la Direction. Le test de propriété (paie-recalcul-utile.
// integration.test.ts) vérifie le comportement ; celui-ci vérifie que la LISTE est complète.

const RACINE = path.resolve(__dirname, "../..");
const lire = (f: string) => fs.readFileSync(path.join(RACINE, f), "utf8");

/** Fichiers `src/lib` atteints depuis `depart` en suivant les imports `@/lib/…` (fermeture transitive). */
function fermeture(depart: string): string[] {
  const vus = new Set<string>();
  const pile = [depart];
  while (pile.length) {
    const f = pile.pop()!;
    const chemin = ["", ".ts", ".tsx"].map((e) => `${f}${e}`).find((c) => fs.existsSync(path.join(RACINE, c)) && fs.statSync(path.join(RACINE, c)).isFile());
    if (!chemin || vus.has(chemin)) continue;
    vus.add(chemin);
    for (const m of lire(chemin).matchAll(/from\s+["']@\/lib\/([^"']+)["']/g)) pile.push(`src/lib/${m[1]}`);
  }
  return [...vus];
}

// Le moteur de paie : `calculerLignesPaie` et tout ce qu'il appelle.
const MOTEUR = fermeture("src/lib/paie-batch").filter((f) => !f.endsWith("/prisma.ts"));
const LECTURES = /\b(?:db|tx|prisma)\.([a-zA-Z]+)\.(?:findMany|findFirst|findUnique|findUniqueOrThrow|findFirstOrThrow|count|aggregate|groupBy)\(/g;

describe("empreinte des sources : la liste couvre tout ce que lit le moteur de paie", () => {
  it("le moteur est bien parcouru (le garde-fou n'est pas vide)", () => {
    expect(MOTEUR).toEqual(expect.arrayContaining(["src/lib/paie-batch.ts", "src/lib/paie-reference-donnees.ts", "src/lib/config.ts", "src/lib/paie-hors-calcul.ts", "src/lib/payroll.ts"]));
  });

  // Fichiers du moteur qui portent AUSSI d'autres fonctions (lecteurs d'écrans, aides) que le moteur n'appelle
  // pas : le balayage se fait au fichier, donc il voit plus que le moteur. Chaque exception est nommée.
  const HORS_PAIE: Record<string, string> = {
    payrollLine: "lue par `idsLignesHorsCalcul` & co (paie-hors-calcul.ts) : des SORTIES de la paie, pas des entrées ; le moteur n'importe que `estCalculeEnPaie` et `ORDRE_CONTRATS_ACTIFS` (vérifié plus bas). Les lignes ont leur propre empreinte.",
  };

  it("le moteur n'importe de paie-hors-calcul.ts que la règle pure et l'ordre des contrats (jamais ses lecteurs de lignes)", () => {
    const batch = lire("src/lib/paie-batch.ts");
    const importe = [...batch.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']@\/lib\/paie-hors-calcul["']/g)].flatMap((m) => m[1].split(",").map((x) => x.trim()));
    expect(importe.sort()).toEqual(["ORDRE_CONTRATS_ACTIFS", "estCalculeEnPaie"]);
  });

  it("chaque modèle Prisma lu par le moteur figure dans SOURCES_PAIE", () => {
    const lus = new Map<string, string[]>();
    for (const f of MOTEUR) for (const m of lire(f).matchAll(LECTURES)) lus.set(m[1], [...(lus.get(m[1]) ?? []), f]);
    const couverts = new Set(SOURCES_PAIE.map((s) => s.modele));
    const manquants = [...lus.keys()].filter((k) => !couverts.has(k) && !(k in HORS_PAIE));
    expect(manquants, `Modèles lus par le moteur mais absents de l'empreinte : ${manquants.map((k) => `${k} (${lus.get(k)})`).join(", ")}`).toEqual([]);
    // Et l'inverse : rien d'inutile dans la liste (une table qu'aucun fichier du moteur ne lit n'a rien à faire là, sauf via une relation).
    const viaRelation = new Set(["retenuePret", "trancheIprCDF", "parametreLegal", "shift"]);
    const inutiles = [...couverts].filter((k) => !lus.has(k) && !viaRelation.has(k));
    expect(inutiles).toEqual([]);
  });

  it("les relations chargées par include/select (prêts → retenues, exercice → paramètres et barème, créneau → shift) sont couvertes", () => {
    const texte = MOTEUR.map(lire).join("\n");
    const relations: Record<string, string> = { retenues: "retenuePret", parametres: "parametreLegal", tranchesIpr: "trancheIprCDF", shift: "shift" };
    const couverts = new Set(SOURCES_PAIE.map((s) => s.modele));
    for (const [relation, modele] of Object.entries(relations)) {
      expect(texte, `la relation « ${relation} » n'est plus lue : retirer la ligne ou la source`).toMatch(new RegExp(`\\b${relation}\\b`));
      expect(couverts.has(modele), `${relation} → ${modele} doit figurer dans SOURCES_PAIE`).toBe(true);
    }
    // Aucune AUTRE relation chargée par `include` : l'ajouter exige de la déclarer ici.
    const inclus = new Set<string>();
    for (const m of texte.matchAll(/include:\s*\{([^}]*)\}/g)) for (const k of m[1].matchAll(/(\w+)\s*:/g)) inclus.add(k[1]);
    expect([...inclus].filter((k) => !(k in relations) && !["select", "orderBy", "ordre"].includes(k))).toEqual([]);
  });

  it("aucune requête SQL brute, aucune lecture hors Prisma dans le moteur", () => {
    for (const f of MOTEUR) {
      const t = lire(f);
      expect(t, f).not.toMatch(/\$queryRaw|\$executeRaw|\.\$transaction\(/);
      expect(t, f).not.toMatch(/\bfetch\(|readFile|from\s+["']node:fs|process\.env/);
    }
  });

  it("le moteur ne dépend pas de l'horloge ni du hasard (sinon l'empreinte des sources ne suffirait pas)", () => {
    // dates-fr.ts et heure-kinshasa.ts DÉFINISSENT des aides « maintenant » ; le moteur ne doit pas les appeler.
    const aidesMaintenant = /\b(?:lundiCourantKinshasa|jourCourantKinshasaISO|moisCourantKinshasa|anneeCouranteKinshasa|numeroMoisCourantKinshasa)\s*\(/;
    // erreur-metier.ts : `Math.random` ne sert qu'à la RÉFÉRENCE d'une erreur affichée, jamais à un montant.
    for (const f of MOTEUR.filter((x) => !/(dates-fr|heure-kinshasa|erreur-metier)\.ts$/.test(x))) {
      const t = lire(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      expect(t, f).not.toMatch(/Date\.now\(|new Date\(\s*\)|Math\.random|performance\.now|randomUUID/);
      expect(t, f).not.toMatch(aidesMaintenant);
    }
  });

  it("chaque source désigne un modèle et une table réels ; chaque colonne exclue existe", () => {
    const modeles = new Map(Prisma.dmmf.datamodel.models.map((m) => [m.name, m]));
    for (const s of SOURCES_PAIE) {
      const modele = modeles.get(s.table);
      expect(modele, `table ${s.table}`).toBeDefined();
      expect(s.modele, "accesseur Prisma = nom du modèle en lowerCamel").toBe(s.table.charAt(0).toLowerCase() + s.table.slice(1));
      for (const i of s.ignorer ?? []) {
        expect(modele!.fields.map((f) => f.name), `${s.table}.${i.colonne}`).toContain(i.colonne);
        expect(i.raison.length, `raison de l'exclusion de ${s.table}.${i.colonne}`).toBeGreaterThan(10);
      }
    }
  });

  it("seules les colonnes étrangères à la paie sont exclues du hachage (liste figée : y toucher se décide)", () => {
    const exclues = SOURCES_PAIE.flatMap((s) => (s.ignorer ?? []).map((i) => `${s.table}.${i.colonne}`)).sort();
    expect(exclues).toEqual([
      "Config.espaceEmployeActif", "Config.pointageCode", "Config.pointageLatitude", "Config.pointageLongitude", "Config.pointageRayonM", "Config.updatedAt",
      "Employee.photoUrl", "Employee.updatedAt",
    ].sort());
  });
});

describe("rafraichirPaieDuMois : l'ordre qui rend l'empreinte sûre", () => {
  const src = lire("src/lib/paie-refresh.ts");
  const coeur = src.slice(src.indexOf("export async function rafraichirPaieDuMois"), src.indexOf("export async function lignesNonFigees"));

  it("les SOURCES sont empreintes AVANT toute lecture du moteur, les LIGNES APRÈS leur écriture", () => {
    const iSources = coeur.indexOf("await empreinteSources(");
    const iMoteur = coeur.indexOf("await calculerLignesPaie(");
    const iEcriture = coeur.indexOf("await tx.payrollLine.createMany(");
    const iLignes = coeur.indexOf("await empreinteLignes(");
    const iEnregistre = coeur.indexOf("empreinteCalcul:");
    expect(iSources).toBeGreaterThan(0);
    expect(iSources).toBeLessThan(iMoteur);
    expect(iMoteur).toBeLessThan(iEcriture);
    expect(iEcriture).toBeLessThan(iLignes);
    expect(iLignes).toBeLessThan(iEnregistre);
    // Une seule prise des sources, jamais après le calcul.
    expect(coeur.match(/empreinteSources\(/g)).toHaveLength(1);
    // …et la run est verrouillée avant la prise.
    expect(coeur.indexOf("FOR UPDATE")).toBeLessThan(iSources);
  });

  it("une ligne rouverte PENDANT le calcul (ensemble des figées changé) : aucune empreinte enregistrée", () => {
    expect(coeur).toMatch(/memesLignesFigees\(figees, lignesFigees\.map\(\(l\) => l\.id\)\)/);
    expect(coeur).toMatch(/empreinteCalcul: figeesInchangees \? texteEmpreinte\(/);
    expect(memesLignesFigees(["b", "a"], ["a", "b"])).toBe(true);
    expect(memesLignesFigees([], [])).toBe(true);
    expect(memesLignesFigees(["a"], ["a", "b"])).toBe(false);
    expect(memesLignesFigees(["a", "c"], ["a", "b"])).toBe(false);
  });

  it("le recalcul forcé (bouton, réinitialisation, tests) ne consulte jamais l'empreinte : seul l'AFFICHAGE peut s'en dispenser", () => {
    expect(coeur).not.toContain("paieInchangee");
    expect(coeur).not.toContain("paieAJour");
    const affichage = src.slice(src.indexOf("export async function rafraichirPaieAffichee"));
    expect(affichage).toContain("paieInchangee(");
    expect(src.match(/paieInchangee\(/g)).toHaveLength(2); // l'appel + la définition
  });
});

describe("paieAJour : la décision, pure", () => {
  const empreinte = { sources: "abc", lignes: "5:123" };
  const t0 = Date.UTC(2026, 9, 13, 10, 0, 0);
  const run = { empreinteCalcul: texteEmpreinte(empreinte), calculeLe: new Date(t0) };

  it("même empreinte, calcul récent : à jour", () => {
    expect(paieAJour(run, empreinte, t0 + 1000)).toBe(true);
    expect(paieAJour(run, empreinte, t0 + GARDE_RECALCUL_MS - 1)).toBe(true);
  });
  it("garde temporelle échue : recalcul", () => {
    expect(paieAJour(run, empreinte, t0 + GARDE_RECALCUL_MS)).toBe(false);
    expect(paieAJour(run, empreinte, t0 + 24 * 3_600_000)).toBe(false);
  });
  it("calcul daté du futur : recalcul", () => {
    expect(paieAJour(run, empreinte, t0 - 1)).toBe(false);
    expect(garderRecente(new Date(t0), t0 - 60_000)).toBe(false);
  });
  it("empreinte absente, instant absent, ou différente (sources comme lignes) : recalcul", () => {
    expect(paieAJour({ ...run, empreinteCalcul: null }, empreinte, t0)).toBe(false);
    expect(paieAJour({ ...run, calculeLe: null }, empreinte, t0)).toBe(false);
    expect(paieAJour(run, { ...empreinte, sources: "abd" }, t0)).toBe(false);
    expect(paieAJour(run, { ...empreinte, lignes: "5:124" }, t0)).toBe(false);
  });
  it("une autre version de formule invalide les empreintes enregistrées", () => {
    expect(run.empreinteCalcul.startsWith(`${VERSION_EMPREINTE}:`)).toBe(true);
    expect(paieAJour({ ...run, empreinteCalcul: run.empreinteCalcul.replace(VERSION_EMPREINTE, "v0") }, empreinte, t0)).toBe(false);
  });
  it("la garde est de 10 minutes (une valeur qui change se décide, elle ne se glisse pas)", () => {
    expect(GARDE_RECALCUL_MS).toBe(600_000);
  });
});

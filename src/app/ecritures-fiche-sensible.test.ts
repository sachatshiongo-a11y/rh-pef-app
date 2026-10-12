import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { CHAMPS_SENSIBLES } from "@/lib/fiche-sensible";

/**
 * GARDE-FOU : AUCUNE ÉCRITURE D'UN CHAMP SENSIBLE DE LA FICHE HORS D'UNE LISTE BLANCHE NOMMÉE.
 *
 * Décision de Sacha (2026-10-12) : la RH modifie, la Direction valide. Les champs de
 * `lib/fiche-sensible` (salaire, heures, transport, frais médicaux, enfants, CNSS, embauche, contrat,
 * national/expatrié, catégories, versement) ne s'écrivent donc que par les chemins qui appliquent la
 * règle « Direction = écriture directe, autre rôle = demande ». Le 2026-10-12, la relecture a trouvé
 * trois actions de contrat (ouvertes à la RH) qui recopiaient contrat et salaire sur la fiche sans
 * passer par la demande : aucun test ne le voyait. Celui-ci le voit.
 *
 * Règle : tout appel `employee.update / updateMany / upsert` du code applicatif dont l'argument cite un
 * champ sensible (et TOUT `employee.create / createMany` : une création porte salaire, contrat et compte), ou dont les données ne sont pas un objet littéral lisible (`data: variable`, `...x`),
 * doit venir d'un fichier de la liste blanche ci-dessous — chaque entrée dit POURQUOI elle est sûre.
 * LIMITE ASSUMÉE : analyse de source (pas de suivi de flot) ; elle attrape l'oubli, pas l'écriture
 * construite à l'exécution depuis un autre module.
 */

const SRC = path.join(__dirname, "..");

const LISTE_BLANCHE: Record<string, string> = {
  "lib/demandes-fiche.ts": "Application d'une demande approuvée par la Direction (transaction, verrou, péremption) et recopie Direction/demande du contrat.",
  "lib/historique-salaire.ts": "Chemin historisé du salaire ; appelé par la Direction ou par l'approbation d'une demande.",
  "lib/creation-fiche.ts": "Seul chemin de CRÉATION d'une fiche (`creerFicheTx`) : Direction directe, ou approbation d'une demande de création par la Direction.",
  "app/(app)/employes/actions.ts": "« Modifier » : Direction = écriture directe après contrôle de péremption ; autres rôles = demande (creerDemandeFicheTx).",
  "app/(app)/paie/actions.ts": "Effet SYSTÈME de la validation / réouverture d'un bulletin : remise à zéro puis restitution des frais médicaux du mois (jamais une valeur saisie).",
};

function fichiers(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".") || e.name === "test") continue; // `lib/test` : outils de test
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...fichiers(p));
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p);
  }
  return out;
}

const sansCommentaires = (src: string) => src.replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/\/\*[\s\S]*?\*\//g, "");

/** Texte de chaque appel `employee.update|updateMany|upsert(...)`, jusqu'à la parenthèse fermante. */
export function appelsEcritureEmployee(src: string): string[] {
  const out: string[] = [];
  const re = /\bemployee\s*\.\s*(?:updateMany|update|upsert|createMany|create)\s*\(/g;
  for (let m = re.exec(src); m; m = re.exec(src)) {
    let profondeur = 1, i = re.lastIndex;
    while (i < src.length && profondeur > 0) { const c = src[i++]; if (c === "(") profondeur++; else if (c === ")") profondeur--; }
    out.push(src.slice(m.index, i));
  }
  return out;
}

/** Toute création de fiche (ou upsert, qui peut créer) : réservée à la liste blanche. */
const CREATION = /\bemployee\s*\.\s*(?:create|createMany|upsert)\s*\(/;
const MOT_SENSIBLE = new RegExp(`\\b(?:${CHAMPS_SENSIBLES.join("|")})\\b`);
/** Données non lisibles : `data: variable` ou étalement `...x`. */
const DONNEES_OPAQUES = /\bdata\s*:\s*[^\s{]|\bdata\s*[,}]|\.\.\./;

/** Fichiers fautifs : écriture d'un champ sensible (ou données opaques) hors liste blanche. */
export function ecrituresInterdites(racine: string = SRC, blanche: Record<string, unknown> = LISTE_BLANCHE): string[] {
  const fautes: string[] = [];
  for (const f of fichiers(racine)) {
    const rel = path.relative(racine, f).split(path.sep).join("/");
    if (rel in blanche) continue;
    for (const appel of appelsEcritureEmployee(sansCommentaires(fs.readFileSync(f, "utf8")))) {
      if (CREATION.test(appel) || MOT_SENSIBLE.test(appel) || DONNEES_OPAQUES.test(appel)) fautes.push(`${rel} : ${appel.replace(/\s+/g, " ").slice(0, 140)}`);
    }
  }
  return fautes;
}

describe("écritures des champs sensibles de la fiche salarié", () => {
  it("aucune écriture employee.update/upsert d'un champ sensible hors de la liste blanche", () => {
    expect(ecrituresInterdites()).toEqual([]);
  });

  it("la liste blanche ne contient que des fichiers qui existent et qui écrivent bien la fiche (pas d'entrée morte)", () => {
    for (const rel of Object.keys(LISTE_BLANCHE)) {
      const f = path.join(SRC, rel);
      expect(fs.existsSync(f), rel).toBe(true);
      expect(appelsEcritureEmployee(sansCommentaires(fs.readFileSync(f, "utf8"))).length, rel).toBeGreaterThan(0);
    }
  });

  it("le détecteur voit une écriture interdite (salaire, contrat, données opaques) et laisse passer le reste", () => {
    const appels = (s: string) => appelsEcritureEmployee(s).filter((a) => MOT_SENSIBLE.test(a) || DONNEES_OPAQUES.test(a));
    expect(appels("await tx.employee.update({ where: { id }, data: { salaireMensuel: 9 } })")).toHaveLength(1);
    expect(appels("await prisma.employee.update({ where: { id }, data: { contrat: type } })")).toHaveLength(1);
    expect(appels("await tx.employee.update({ where: { id }, data })")).toHaveLength(1);
    expect(appels("await tx.employee.update({ where: { id }, data: payload })")).toHaveLength(1);
    expect(appelsEcritureEmployee("await prisma.employee.create({ data: { nom: 'x' } })").filter((a) => CREATION.test(a))).toHaveLength(1);
    expect(appels("await prisma.employee.updateMany({ where: { poste: a }, data: { poste: b } })")).toHaveLength(0);
    expect(appels("await prisma.employee.update({ where: { id }, data: { actif: false } })")).toHaveLength(0);
  });
});

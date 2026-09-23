import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

// Garde-fou de la tâche 8 (retrait des anciens chemins de pointage) :
// `pointerArrivee`, `pointerDepart` (bouton « Pointer mon arrivée / mon départ ») et
// `saisirHoraireManuel` (formulaire « + Ajouter un horaire manuel (oubli) », qui permettait
// au salarié de saisir n'importe quelle heure pour n'importe quel jour, même par-dessus un
// pointage QR) ont été supprimés : aucun chemin ne doit plus permettre de pointer sans avoir
// scanné l'affiche (docs/superpowers/specs/2026-09-23-pointage-qr-design.md, §5 et §7).
//
// Ce test lit le code RÉEL sous src/ (hors fichiers de test, qui ont le droit de nommer ces
// identifiants pour vérifier leur absence) et échoue si l'un des trois réapparaît ailleurs que
// dans un commentaire — falsifié en réintroduisant un appel dans un vrai fichier (voir le
// rapport de la tâche 8).

const NOMS_INTERDITS = ["pointerArrivee", "pointerDepart", "saisirHoraireManuel"];

/** Retire les commentaires /* ... *\/ et // ... d'une source TS/TSX (mais pas les chaînes qui contiennent "://"). */
function sansCommentaires(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function fichiersSource(racine: string): string[] {
  const resultat: string[] = [];
  const parcourir = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules") continue;
        parcourir(p);
      } else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.(ts|tsx)$/.test(e.name)) {
        resultat.push(p);
      }
    }
  };
  parcourir(racine);
  return resultat;
}

describe("aucun chemin ne permet de pointer sans scanner l'affiche", () => {
  it("pointerArrivee, pointerDepart et saisirHoraireManuel n'existent plus dans le code (hors commentaires)", () => {
    const fautifs: { fichier: string; nom: string }[] = [];
    for (const p of fichiersSource(path.join(process.cwd(), "src"))) {
      const code = sansCommentaires(fs.readFileSync(p, "utf8"));
      for (const nom of NOMS_INTERDITS) {
        if (new RegExp(`\\b${nom}\\b`).test(code)) {
          fautifs.push({ fichier: path.relative(process.cwd(), p), nom });
        }
      }
    }
    expect(fautifs, "pointerArrivee/pointerDepart/saisirHoraireManuel doivent rester supprimés").toEqual([]);
  });
});

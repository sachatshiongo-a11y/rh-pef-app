// Garde-fou (audit du 10/10/2026, sécurité 6 + ergonomie 3 et 15) : un message d'erreur n'est jamais affiché
// BRUT à l'écran. `e instanceof Error ? e.message : "…"` montrait aussi bien « Le montant dépasse le reste à
// payer » (lisible) que le texte d'une erreur Prisma ou réseau (illisible, et révélateur). Le passage obligé
// est `messageLisible` (src/lib/erreur-metier.ts) côté serveur ; côté client, un texte fixe : les actions
// enrobées rendent leurs refus métier comme `{ erreur }`, ce qui est jeté ne l'est jamais pour être lu.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const RACINE = path.resolve(__dirname, "..");
const FICHIERS = [
  "app/(app)/conges/actions.ts",
  "app/(app)/fiches-poste/actions.ts",
  "app/(stock)/stock/commandes/actions.ts",
  "lib/import-factures.ts",
  "app/(app)/a-valider/conges-inbox.tsx",
  "app/(app)/conges/liste-conges.tsx",
  "app/(app)/planning/actions.ts",
  "app/(app)/employes/nouveau/page.tsx",
];
// `x instanceof Error ? x.message …` ou `x instanceof Error && x.message ? x.message …`
const MESSAGE_BRUT = /instanceof Error\s*(?:&&[^?]*)?\?\s*\w+\.message/;

describe("messages d'erreur : jamais bruts à l'écran", () => {
  for (const f of FICHIERS) {
    it(`${f} passe par messageLisible (ou un texte fixe)`, () => {
      const source = readFileSync(path.join(RACINE, f), "utf8");
      expect(source.match(MESSAGE_BRUT)?.[0] ?? null).toBeNull();
    });
  }
});

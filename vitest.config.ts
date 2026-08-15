import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    hookTimeout: 60000,
    // Beaucoup de tests d'INTÉGRATION démarrent chacun leur propre Postgres embarqué
    // (`creerBaseTest()`), gourmand en RAM (~128 Mo de shared_buffers + overhead par instance) et
    // en CPU (init + `prisma db push` à chaque fois). Sur CETTE machine (8 cœurs, 8 Go de RAM),
    // le parallélisme PAR DÉFAUT de vitest (un worker par cœur, donc jusqu'à 8 Postgres embarqués
    // à la fois) rend la suite instable : le symptôme mesuré (2026-08-15, avant ce commit) était
    // 15/56 fichiers en échec pour 652 s ; en re-mesurant avec `npm test` (donc le parallélisme
    // par défaut) le jour du correctif, sur 3 passages successifs, 2 sont sortis 56/56 verts
    // (51,8 s puis 74,4 s — caches disque/Prisma déjà chauds) mais 1 a échoué avec 1 fichier sur
    // 56 en timeout de setup pour 199,7 s : la contention ne rate pas TOUJOURS, elle rate PARFOIS,
    // ce qui est le pire des deux mondes (personne ne peut distinguer un vrai échec du bruit).
    // Avec `--maxWorkers=2`, tous les passages mesurés sont sortis 56/56 verts (327 s rapportés
    // avant ce commit ; 307,5 s puis 74,5 s en re-mesurant) : jamais d'échec observé sous ce
    // plafond. Le gain de durée n'est donc pas garanti passage par passage (il dépend de l'état
    // du cache disque au moment du run), mais la FIABILITÉ, elle, l'est — c'est elle qui compte :
    // une suite qui échoue au hasard une fois sur trois est inutilisable, quelle que soit sa
    // vitesse. Si cette machine change (plus de RAM, CI dédié), cette valeur peut être révisée —
    // mais elle doit rester une valeur MESURÉE, pas un défaut vitest laissé au hasard.
    maxWorkers: 2,
  },
  resolve: {
    alias: {
      // Les modules serveur importent le paquet « server-only » (garde Next) : neutralisé en test.
      "server-only": path.resolve(__dirname, "src/lib/test/server-only-stub.ts"),
      "@": path.resolve(__dirname, "src"),
    },
  },
});

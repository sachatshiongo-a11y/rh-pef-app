import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    hookTimeout: 60000,
  },
  resolve: {
    alias: {
      // Les modules serveur importent le paquet « server-only » (garde Next) : neutralisé en test.
      "server-only": path.resolve(__dirname, "src/lib/test/server-only-stub.ts"),
      "@": path.resolve(__dirname, "src"),
    },
    // Vite préfère `.js` à `.ts` par défaut. Seule collision du dépôt : `scripts/backup-json.js`
    // (vieux script CommonJS mort) coexiste avec `scripts/backup-json.ts` (le vrai, testé) — un
    // import extensionless de ce dernier résolvait silencieusement vers le mauvais fichier.
    extensions: [".mts", ".ts", ".tsx", ".mjs", ".js", ".jsx", ".json"],
  },
});

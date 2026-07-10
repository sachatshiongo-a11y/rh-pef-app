import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
  },
  resolve: {
    alias: {
      // Les modules serveur importent le paquet « server-only » (garde Next) : neutralisé en test.
      "server-only": path.resolve(__dirname, "src/lib/test/server-only-stub.ts"),
      "@": path.resolve(__dirname, "src"),
    },
  },
});

import { describe, it, expect } from "vitest";
import config from "../../next.config";

// Audit du 10/10/2026, sécurité 3 : aucune page ne portait d'en-tête de sécurité (clickjacking
// possible) et chaque réponse annonçait « x-powered-by: Next.js ».
describe("en-têtes de sécurité (next.config.ts)", () => {
  it("x-powered-by désactivé", () => {
    expect(config.poweredByHeader).toBe(false);
  });

  it("toutes les réponses portent les en-têtes anti-cadre, nosniff, referrer et HSTS", async () => {
    const regles = (await config.headers!()) as { source: string; headers: { key: string; value: string }[] }[];
    const tout = regles.find((r) => r.source === "/:path*");
    expect(tout).toBeDefined();
    const h = Object.fromEntries(tout!.headers.map((e) => [e.key.toLowerCase(), e.value]));
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["content-security-policy"]).toBe("frame-ancestors 'none'");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["strict-transport-security"]).toMatch(/^max-age=\d{8,}/);
  });

  it("aucune politique de scripts : elle casserait la PWA, le service worker et pdf.js", async () => {
    const regles = (await config.headers!()) as { headers: { key: string; value: string }[] }[];
    for (const r of regles) for (const e of r.headers) {
      if (e.key.toLowerCase() === "content-security-policy") expect(e.value).not.toMatch(/script-src|default-src|worker-src/);
    }
  });
});

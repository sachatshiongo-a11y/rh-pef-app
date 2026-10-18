import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { HOTES_REDIRIGES } from "@/lib/supabase/middleware";

// Audit du 10/10/2026, sécurité 9 : les tâches planifiées GitHub appelaient rh.patesenfolie.cd,
// redirigée (308) vers gestion.patesenfolie.cd depuis le 2026-09-29. `curl -fsS` ne suit pas une
// redirection ET ne la traite pas comme une erreur : la tâche sortait « verte » sans que la route
// ne soit jamais appelée (rappels quotidiens, rapport mensuel). Une tâche planifiée appelle donc
// directement l'adresse servie, jamais une adresse redirigée.
const DOSSIER = path.resolve(__dirname, "../../.github/workflows");

describe("tâches planifiées GitHub", () => {
  const fichiers = fs.readdirSync(DOSSIER).filter((f) => /\.ya?ml$/.test(f));
  const appels = fichiers.flatMap((f) => [...fs.readFileSync(path.join(DOSSIER, f), "utf8").matchAll(/https:\/\/([a-z0-9.-]+)\/api\/cron\/[\w-]+/g)].map((m) => ({ f, hote: m[1] })));

  it("les quatre tâches (rappels quotidiens, rapport mensuel, courriel quotidien et rapport mensuel du Stock) appellent une route de cron", () => {
    expect(appels.map((a) => a.f).sort()).toEqual(expect.arrayContaining(["rapport-mensuel.yml", "rappels-quotidiens.yml", "stock-mensuel.yml", "stock-quotidien.yml"]));
  });

  // Chaque tâche appelle la route de SON nom, avec le jeton partagé, à l'heure promise. Décision de la Direction
  // (2026-10-18) : les deux envois QUOTIDIENS partent à 8 h à Kinshasa (UTC+1) = 07:00 UTC, du lundi au samedi
  // (jours 1-6, pas de dimanche) ; les rapports MENSUELS restent le 1er à 7 h (06:00 UTC).
  it.each([
    ["rappels-quotidiens.yml", "/api/cron/alertes", '"0 7 * * 1-6"'],
    ["stock-quotidien.yml", "/api/cron/stock-quotidien", '"0 7 * * 1-6"'],
    ["stock-mensuel.yml", "/api/cron/stock-mensuel", '"0 6 1 * *"'],
    ["rapport-mensuel.yml", "/api/cron/rapport-mensuel", '"0 6 1 * *"'],
  ])("%s : bonne route, jeton CRON_SECRET, planning promis", (fichier, route, planning) => {
    const src = fs.readFileSync(path.join(DOSSIER, fichier), "utf8");
    expect(src).toContain(`https://gestion.patesenfolie.cd${route}`);
    expect(src).toContain("Authorization: Bearer ${{ secrets.CRON_SECRET }}");
    expect(src).toContain(`cron: ${planning}`);
    expect(src).toContain("workflow_dispatch");
    // `-f` : un 401/500 de la route fait échouer la tâche (rouge dans GitHub) au lieu de passer pour un succès.
    expect(src).toMatch(/curl -fsS/);
  });

  // Un seul envoi par période côté serveur : le bouton « Run workflow » doit pouvoir renvoyer (?forcer=1), mais la
  // tâche planifiée, JAMAIS (sinon le second déclencheur renverrait chaque jour).
  it.each(["rappels-quotidiens.yml", "stock-quotidien.yml", "stock-mensuel.yml", "rapport-mensuel.yml"])("%s : ?forcer=1 seulement au lancement manuel", (fichier) => {
    const src = fs.readFileSync(path.join(DOSSIER, fichier), "utf8");
    expect(src).toMatch(/workflow_dispatch:[^\n]*\n\s*inputs:\s*\n\s*forcer:/);
    expect(src).toContain("github.event_name == 'workflow_dispatch' && inputs.forcer");
    expect(src).toContain('URL="$URL?forcer=1"');
    // Le `forcer` n'est jamais dans l'adresse écrite en dur : la tâche planifiée appelle l'adresse nue.
    expect(src).not.toMatch(/api\/cron\/[\w-]+\?forcer/);
    expect(src).toMatch(/"\$URL"\s*$/);
  });

  it.each([["gestion.patesenfolie.cd"]])("toutes appellent %s, jamais une adresse redirigée", (attendu) => {
    for (const a of appels) {
      expect(Object.keys(HOTES_REDIRIGES), `${a.f} appelle une adresse redirigée`).not.toContain(a.hote);
      expect(a.hote, a.f).toBe(attendu);
    }
  });
});

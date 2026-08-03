#!/usr/bin/env node
/**
 * DÉPLOIEMENT À LA DEMANDE — déclenche un build Render, et un seul.
 *
 * Pourquoi ce script existe (décision du 2026-08-03) : les quatre applications déployées sur Render
 * étaient toutes en `autoDeploy: true`. Chaque push sur `main` reconstruisait la production entière
 * (npm ci + prisma generate + migrate deploy + durcissement + next build, 5 à 8 minutes). En
 * juillet 2026, 516 commits sur les quatre dépôts ont produit ~516 builds, soit de l'ordre de
 * 3 000 minutes de pipeline — le quota mensuel a sauté et Render a cessé de déployer.
 *
 * Le travail n'était pas en cause, le RYTHME l'était : sur une session, quinze pushes déclenchaient
 * quinze builds là où le dernier seul comptait. Désormais on pousse autant qu'on veut, et la
 * production ne se reconstruit que quand on le demande — ici.
 *
 * L'URL du hook est un SECRET : qui l'a peut déclencher des déploiements. Elle ne vit donc pas dans
 * le dépôt mais dans `.env.local` (gitignoré) :
 *
 *     RENDER_DEPLOY_HOOK="https://api.render.com/deploy/srv-xxxx?key=yyyy"
 *
 * On la récupère sur Render : le service → Settings → Deploy Hook.
 *
 * Usage :  npm run deployer
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Lit RENDER_DEPLOY_HOOK depuis l'environnement, à défaut depuis .env.local. */
function lireHook() {
  if (process.env.RENDER_DEPLOY_HOOK) return process.env.RENDER_DEPLOY_HOOK.trim();
  try {
    const contenu = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    // Tolère les guillemets et les espaces autour du `=` — on lit un fichier écrit à la main.
    const ligne = contenu.split("\n").find((l) => l.trim().startsWith("RENDER_DEPLOY_HOOK"));
    if (!ligne) return null;
    const valeur = ligne.slice(ligne.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "");
    return valeur || null;
  } catch {
    return null;
  }
}

const hook = lireHook();
if (!hook) {
  console.error(
    [
      "✗ RENDER_DEPLOY_HOOK introuvable.",
      "",
      "  Récupérez l'URL sur Render : le service → Settings → Deploy Hook,",
      "  puis ajoutez-la à .env.local (fichier gitignoré, jamais commité) :",
      "",
      '    RENDER_DEPLOY_HOOK="https://api.render.com/deploy/srv-xxxx?key=yyyy"',
    ].join("\n"),
  );
  process.exit(1);
}

if (!/^https:\/\/api\.render\.com\/deploy\//.test(hook)) {
  // Garde-fou : une URL qui n'est pas celle de Render enverrait la clé ailleurs.
  console.error("✗ RENDER_DEPLOY_HOOK ne ressemble pas à un Deploy Hook Render (https://api.render.com/deploy/…). Rien n'a été envoyé.");
  process.exit(1);
}

console.log("→ Déclenchement du déploiement Render…");
const reponse = await fetch(hook, { method: "POST" });
const corps = await reponse.text();

if (!reponse.ok) {
  console.error(`✗ Render a répondu ${reponse.status}. ${corps.slice(0, 300)}`);
  process.exit(1);
}

console.log("✓ Déploiement lancé. Suivez-le sur le tableau de bord Render (onglet Events).");
if (corps.trim()) console.log(`  Réponse : ${corps.trim().slice(0, 200)}`);

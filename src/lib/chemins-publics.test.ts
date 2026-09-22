import { describe, it, expect } from "vitest";
import { config } from "@/proxy";
import { cheminPublic } from "@/lib/supabase/middleware";

// ─────────────────────────────────────────────────────────────────────────────
// LE GARDE D'AUTHENTIFICATION : NI TROP LARGE, NI TROP ÉTROIT (2026-09-05).
//
// DEUX DÉFAUTS OPPOSÉS, QUI SE PRODUISENT TOUS LES DEUX EN SILENCE.
//
// 1. TROP LARGE — la fuite d'accès. Le test des chemins publics était un `startsWith` NU :
//    `PUBLIC_PATHS.some((p) => pathname.startsWith(p))`. Une future page « /login-technicien » ou
//    « /reinitialiser-tout » serait donc devenue publique sans que personne ne l'ait décidé, et
//    sans que rien ne le signale. Au moment de la correction, aucune route du dépôt ne commençait
//    par un préfixe public sans être ce préfixe : la fuite était LATENTE, pas ouverte. C'est
//    précisément pour cela qu'il fallait la fermer — elle se serait ouverte toute seule.
//
// 2. TROP ÉTROIT — la fonction inerte. Ce que le NAVIGATEUR va chercher de lui-même (le manifeste,
//    le script du service worker, les icônes) ne doit jamais être derrière le garde. Sur le dépôt
//    frère atelier-dominique-app, ce piège s'est refermé TROIS fois : le manifeste a cessé d'être
//    valide, et le script du service worker répondait par une redirection — ce que la spécification
//    interdit, si bien que son enregistrement échouait purement et simplement. Rien n'échouait
//    bruyamment : la fonction était simplement inerte.
//
// CE QUE CE FICHIER VÉRIFIE, ET COMMENT. Il n'inspecte pas le texte des sources : il exécute les
// DEUX mécanismes réels qui décident —
//   • le motif du proxy (`src/proxy.ts`), qui dit quelles requêtes le garde examine ;
//   • `cheminPublic` (`src/lib/supabase/middleware.ts`), qui dit lesquelles passent sans session.
// Une adresse est atteignable sans session si l'un OU l'autre la laisse passer.
//
// CE QU'IL NE VÉRIFIE PAS : que la ressource existe et réponde 200 — c'est l'affaire du build. Il
// ne vérifie que l'absence de garde d'authentification devant elle.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Les adresses que le NAVIGATEUR récupère de lui-même, sans qu'une personne connectée l'ait
 * demandé — donc potentiellement sans cookie de session. Aucune ne porte de donnée.
 *
 * Y AJOUTER UNE ADRESSE EST UNE DÉCISION : elle devient publique.
 */
const RECUPEREES_SANS_SESSION = [
  { chemin: "/manifest.json", pourquoi: "le manifeste PWA, lu à l'installation depuis n'importe quel écran" },
  { chemin: "/sw.js", pourquoi: "le script du service worker ; une redirection fait échouer son enregistrement" },
  { chemin: "/icons/icon-192.png", pourquoi: "l'icône de l'écran d'accueil" },
  { chemin: "/icons/icon-512.png", pourquoi: "l'icône de l'écran d'accueil" },
  {
    chemin: "/pdf.worker.min.mjs",
    pourquoi:
      "le worker de pdf.js, que la visionneuse de documents va chercher seule ; derrière le garde, " +
      "il répond 307 vers /login et aucun PDF ne s'affiche plus sur iPhone",
  },
];

/** Le motif du proxy dit quelles requêtes le garde EXAMINE. Hors motif = jamais examinée. */
function examineeParLeGarde(chemin: string): boolean {
  const motifs = config.matcher as string[];
  return motifs.some((m) => new RegExp(`^${m}$`).test(chemin));
}

describe("le garde d'authentification ne laisse pas fuir, et ne bloque pas ce qu'il ne doit pas", () => {
  it("les chemins publics se comparent exactement, jamais par préfixe", () => {
    // Le cœur de la correction. Chaque paire : ce qui doit passer, et le voisin qui ne doit pas.
    expect(cheminPublic("/login")).toBe(true);
    expect(cheminPublic("/login-technicien"), "un préfixe nu rendrait cette page publique").toBe(false);

    expect(cheminPublic("/reinitialiser")).toBe(true);
    expect(cheminPublic("/reinitialiser-tout"), "un préfixe nu rendrait cette page publique").toBe(false);

    expect(cheminPublic("/mot-de-passe-oublie")).toBe(true);
    expect(cheminPublic("/mot-de-passe-oublie-encore")).toBe(false);

    // Un sous-chemin RESTE public : « /reinitialiser/xyz » appartient bien à la page publique.
    expect(cheminPublic("/reinitialiser/jeton-quelconque")).toBe(true);
  });

  it("les écrans d'argent et de personnes restent privés", () => {
    for (const prive of ["/paie", "/employes", "/declarations", "/conges", "/presences", "/utilisateurs"]) {
      expect(cheminPublic(prive), `${prive} ne doit JAMAIS être public`).toBe(false);
    }
  });

  it("rien de ce que le navigateur récupère seul n'est bloqué par le garde", () => {
    const bloquees = RECUPEREES_SANS_SESSION.filter(
      ({ chemin }) => examineeParLeGarde(chemin) && !cheminPublic(chemin),
    );

    expect(
      bloquees.map((b) => `${b.chemin} — ${b.pourquoi}`),
      "Adresse(s) derrière le garde alors que le navigateur les récupère sans session. Les exclure " +
        "du motif de `src/proxy.ts` (fichiers statiques) ou les ajouter à `PUBLIC_PATHS` (pages) :",
    ).toEqual([]);
  });

  it("le garde examine bien les écrans ordinaires — sinon ce fichier ne vérifierait rien", () => {
    // Plancher anti-silence : si le motif du proxy cessait de correspondre à quoi que ce soit, le
    // test ci-dessus passerait au vert en ne protégeant plus personne.
    expect(examineeParLeGarde("/paie")).toBe(true);
    expect(examineeParLeGarde("/employes")).toBe(true);
  });
});

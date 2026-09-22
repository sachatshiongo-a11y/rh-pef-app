import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// LE CACHE DE LA COQUILLE NE DOIT JAMAIS RETENIR DE DONNÉE (2026-09-22).
//
// `public/sw.js` n'est pas un module : c'est un script que le navigateur exécute avec son propre
// `self`. Personne ne l'importe, donc rien ne le vérifie — et un service worker qui se trompe se
// trompe EN SILENCE, sur l'appareil de quelqu'un d'autre, parfois pour des semaines (c'est
// exactement ainsi que le dépôt frère a gardé une page de connexion en cache sous le nom de sa page
// hors ligne).
//
// Ce fichier l'exécute donc pour de vrai, avec un faux `self`, un faux cache et un faux réseau,
// puis lui envoie de vraies requêtes. Il vérifie CE QU'IL FAIT, pas ce qu'il dit :
//   • une navigation vient du réseau, et du réseau seul ;
//   • sans réseau, elle reçoit la page hors ligne — jamais une page mise en cache ;
//   • les fichiers compilés et les icônes viennent du cache ;
//   • tout le reste — dont `/_next/image`, qui peut rendre la photo d'une personne — n'est PAS
//     intercepté, donc jamais mis en cache.
// ─────────────────────────────────────────────────────────────────────────────

const ORIGINE = "https://exemple.test";

type Requete = { url: string; method: string; mode?: string };

function requete(chemin: string, options: { method?: string; mode?: string } = {}): Requete {
  return { url: ORIGINE + chemin, method: options.method ?? "GET", mode: options.mode };
}

/** Cache mémoire minimal : les mêmes opérations que celles utilisées par le service worker. */
function fauxCaches(reseau: (r: Requete) => Promise<Response>) {
  const boites = new Map<string, Map<string, Response>>();
  const cle = (c: Requete | string) => (typeof c === "string" ? c : new URL(c.url).pathname);
  return {
    boites,
    open: async (nom: string) => {
      const boite = boites.get(nom) ?? new Map<string, Response>();
      boites.set(nom, boite);
      return {
        // `cache.add` va chercher la ressource au RÉSEAU et REJETTE si elle ne répond pas — c'est
        // ce rejet que l'installation doit absorber pour ne pas emporter les notifications.
        add: async (chemin: string) => {
          const reponse = await reseau(requete(chemin));
          if (!reponse.ok) throw new Error("cache.add : réponse non valide");
          boite.set(chemin, reponse);
        },
        put: async (c: Requete, reponse: Response) => { boite.set(cle(c), reponse); },
      };
    },
    match: async (c: Requete | string) => {
      for (const boite of boites.values()) { const r = boite.get(cle(c)); if (r) return r; }
      return undefined;
    },
    keys: async () => [...boites.keys()],
    delete: async (nom: string) => boites.delete(nom),
  };
}

type Ecouteurs = Record<string, (evenement: Record<string, unknown>) => void>;

/** Exécute `public/sw.js` tel qu'il est livré, dans un environnement de service worker simulé. */
function chargerServiceWorker(reseau: (r: Requete) => Promise<Response>) {
  const source = readFileSync(path.join(process.cwd(), "public", "sw.js"), "utf8");
  const ecouteurs: Ecouteurs = {};
  const self = {
    location: { origin: ORIGINE },
    addEventListener: (nom: string, f: Ecouteurs[string]) => { ecouteurs[nom] = f; },
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  };
  const caches = fauxCaches(reseau);
  new Function("self", "caches", "fetch", source)(self, caches, reseau);
  return { ecouteurs, caches };
}

/** Envoie une requête au service worker. `undefined` = il ne s'en mêle pas (pas de `respondWith`). */
function demander(sw: ReturnType<typeof chargerServiceWorker>, r: Requete): Promise<Response> | undefined {
  let promesse: Promise<Response> | undefined;
  sw.ecouteurs.fetch({ request: r, respondWith: (p: Promise<Response> | Response) => { promesse = Promise.resolve(p); } });
  return promesse;
}

async function installer(sw: ReturnType<typeof chargerServiceWorker>) {
  let attendu: Promise<unknown> | undefined;
  sw.ecouteurs.install({ waitUntil: (p: Promise<unknown>) => { attendu = p; } });
  await attendu;
}

const PAGE_HORS_LIGNE = "PAGE HORS LIGNE";

/** Réseau qui répond à tout, et sert la vraie page hors ligne sous son adresse. */
function reseauDisponible(r: Requete) {
  const chemin = new URL(r.url).pathname;
  const corps = chemin === "/hors-ligne" ? PAGE_HORS_LIGNE : `RÉSEAU ${chemin}`;
  return Promise.resolve(new Response(corps, { status: 200 }));
}

const reseauCoupe = () => Promise.reject(new Error("réseau injoignable"));

/** Laisse passer les promesses que le service worker ne fait pas attendre (la mise en cache). */
const tic = () => new Promise((resoudre) => setTimeout(resoudre, 0));

describe("service worker — la coquille, et rien d'autre", () => {
  it("une navigation vient du réseau, jamais du cache — même si une page traîne dedans", async () => {
    const sw = chargerServiceWorker(reseauDisponible);
    await installer(sw);

    // On EMPOISONNE le cache avec une page d'hier. Une règle « cache d'abord » posée un jour sur
    // les navigations la servirait — des montants périmés présentés comme ceux du jour. C'est ce
    // que cette assertion interdit ; sans cette ligne, le test passerait au vert quoi qu'il arrive,
    // puisque rien ne met jamais de page en cache.
    const boite = await sw.caches.open("coquille-v1");
    await boite.put(requete("/paie"), new Response("PAGE PÉRIMÉE", { status: 200 }));

    const reponse = await demander(sw, requete("/paie", { mode: "navigate" }))!;

    expect(await reponse.text()).toBe("RÉSEAU /paie");
  });

  it("sans réseau, une navigation reçoit la page hors ligne — pas la page de connexion", async () => {
    let coupe = false;
    const sw = chargerServiceWorker((r) => (coupe ? reseauCoupe() : reseauDisponible(r)));
    await installer(sw); // l'installation met /hors-ligne en cache
    coupe = true;

    const reponse = await demander(sw, requete("/accueil", { mode: "navigate" }))!;

    expect(await reponse.text()).toBe(PAGE_HORS_LIGNE);
  });

  it("si même la page hors ligne manque, on répond une phrase, jamais une erreur brute", async () => {
    // Cache vide : installation jamais réussie, ou cache purgé par le navigateur.
    const sw = chargerServiceWorker(reseauCoupe);

    const reponse = await demander(sw, requete("/accueil", { mode: "navigate" }))!;

    expect(reponse.status).toBe(503);
    expect(await reponse.text()).toContain("Pas de connexion");
  });

  it("l'installation sans réseau n'emporte pas les notifications avec elle", async () => {
    const sw = chargerServiceWorker(reseauCoupe);

    // Le test EST l'absence de rejet : un `waitUntil` rejeté fait échouer l'installation entière,
    // donc aussi `push` et `notificationclick` — un téléphone neuf installé hors réseau se
    // retrouverait sans aucune notification.
    await expect(installer(sw)).resolves.toBeUndefined();
  });

  it("un fichier compilé est servi depuis le cache, même quand le réseau est tombé", async () => {
    let coupe = false;
    const sw = chargerServiceWorker((r) => (coupe ? reseauCoupe() : reseauDisponible(r)));
    const chemin = "/_next/static/chunks/abc.js";

    const premiere = await demander(sw, requete(chemin))!; // remplit le cache au passage
    expect(await premiere.text()).toBe(`RÉSEAU ${chemin}`);
    await tic(); // la mise en cache n'est pas attendue par le service worker

    coupe = true; // LE test : sans cache, cette seconde demande échouerait
    const seconde = await demander(sw, requete(chemin))!;
    expect(await seconde.text()).toBe(`RÉSEAU ${chemin}`);
  });

  it("les icônes de l'application entrent dans la coquille", async () => {
    const sw = chargerServiceWorker(reseauDisponible);
    await demander(sw, requete("/icons/icon-192.png"))!;
    await tic();
    expect(await sw.caches.match(requete("/icons/icon-192.png"))).toBeDefined();
  });

  it("une image rendue par /_next/image n'est JAMAIS interceptée — elle peut porter un visage", () => {
    const sw = chargerServiceWorker(reseauDisponible);
    expect(demander(sw, requete("/_next/image?url=%2Fphoto-salarie.png&w=64&q=75"))).toBeUndefined();
  });

  it("ni les routes, ni les écritures, ni les autres domaines ne passent par le cache", async () => {
    const sw = chargerServiceWorker(reseauDisponible);

    expect(demander(sw, requete("/api/employes"))).toBeUndefined();
    expect(demander(sw, requete("/paie", { method: "POST", mode: "navigate" }))).toBeUndefined();
    expect(demander(sw, { url: "https://autre-domaine.test/_next/static/chunks/x.js", method: "GET" })).toBeUndefined();
  });
});

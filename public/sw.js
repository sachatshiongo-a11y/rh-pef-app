// Service worker — Web Push ET coquille hors ligne pour RH Pâtes en Folie (PWA).
//
// IL FAIT TROIS CHOSES, ET RIEN D'AUTRE : afficher la notification que le serveur envoie, ouvrir
// l'écran au clic, et servir depuis un cache la SEULE coquille statique de l'application (JS
// compilé, CSS, polices, icônes), plus la page « pas de connexion ».

// ─────────────────────────────────────────────────────────────────────────────
// CACHE DE LA SEULE COQUILLE (repris d'atelier-dominique-app, 2026-09-04 — posé ici le 2026-09-22).
//
// CE QUI EST INTERDIT ICI, ET LE RESTE : toute réponse de route, de Server Action, d'export ou de
// document, ET TOUTE PAGE HTML RENDUE. Les pages de cette application portent des salaires, des
// montants et des noms ; une page servie depuis un cache afficherait les chiffres d'hier avec
// l'assurance d'aujourd'hui.
//
// LE SEUL ÉCART : quand une navigation échoue faute de réseau, on sert `/hors-ligne`, une page qui
// ne contient AUCUNE donnée et dit simplement qu'il n'y a pas de connexion (voir
// src/app/hors-ligne/page.tsx). Ce n'est pas servir du périmé : c'est remplacer le dinosaure du
// navigateur par une phrase de l'application.
//
// `/_next/image` N'ENTRE PAS DANS LA COQUILLE — écart assumé avec le dépôt frère, qui y nomme ses
// logos un par un. Cette adresse est un rendu d'image paramétré : elle sert le logo aujourd'hui,
// elle servira demain ce qu'on lui donnera, y compris la photo d'une personne. Une règle « cache
// d'abord » posée dessus finirait par garder un visage sur l'appareil. On s'en tient donc à ce que
// le compilateur versionne (`/_next/static/`) et aux icônes de l'application (`/icons/`) :
// immuables, et sans aucune donnée. Le logo, lui, passe par le réseau — hors ligne il manque, et
// une image absente sur une page qui s'affiche n'est pas un défaut grave.
//
// UN SEUL SERVICE WORKER SUR LA PORTÉE `/` : ce fichier GARDE SON NOM (`sw.js`). Les téléphones
// déjà installés y sont abonnés pour les notifications ; en enregistrer un second sous un autre nom
// aurait désenregistré celui-ci et arrêté les notifications en place.
// ─────────────────────────────────────────────────────────────────────────────
const CACHE = "coquille-v1"; // relever la version force la purge à l'activation suivante
const HORS_LIGNE = "/hors-ligne";

/** Dernier repli quand même la page hors ligne manque au cache : une phrase, aucune donnée. */
function repliHorsLigne() {
  return new Response(
    '<!doctype html><html lang="fr"><meta charset="utf-8">'
      + '<meta name="viewport" content="width=device-width, initial-scale=1">'
      + "<title>Pas de connexion</title>"
      + '<p style="font-family:system-ui;padding:2rem;text-align:center">'
      + "Pas de connexion. Vos données sont sur le serveur et reviendront dès que la connexion "
      + "sera rétablie.</p>",
    { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

self.addEventListener("install", (event) => {
  // On ne précharge QUE la page hors ligne : le reste de la coquille entre en cache au fil de
  // l'usage. Précharger une liste de fichiers compilés obligerait à la tenir à jour à la main, et
  // elle se démoderait au premier build.
  //
  // LE `catch` N'EST PAS DÉCORATIF : `cache.add` REJETTE si la réponse n'est pas un succès ou si le
  // réseau lâche, et un `waitUntil` rejeté fait échouer l'INSTALLATION ENTIÈRE du service worker —
  // donc aussi `push` et `notificationclick`. Une coupure au moment où l'on installe l'application
  // sur un téléphone neuf le priverait de TOUTE notification. La page hors ligne est un confort ;
  // les notifications ne le sont pas. Elle entrera en cache à la prochaine installation réussie.
  event.waitUntil(
    caches.open(CACHE)
      .then((c) => c.add(HORS_LIGNE))
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((noms) => Promise.all(noms.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

/** Un fichier de coquille : versionné par le compilateur ou figé dans le dépôt, donc immuable, et
 *  sans aucun chiffre. Tout le reste passe par le réseau. */
function estCoquille(url) {
  return url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/");
}

self.addEventListener("fetch", (event) => {
  const requete = event.request;
  if (requete.method !== "GET") return; // une écriture ne passe jamais par un cache
  const url = new URL(requete.url);
  if (url.origin !== self.location.origin) return; // rien des autres domaines

  if (estCoquille(url)) {
    // Cache d'abord : ces fichiers sont immuables, aller les redemander ne change jamais rien.
    event.respondWith(
      caches.match(requete).then((enCache) => enCache || fetch(requete).then((reponse) => {
        if (reponse.ok) { const copie = reponse.clone(); caches.open(CACHE).then((c) => c.put(requete, copie)); }
        return reponse;
      }))
    );
    return;
  }

  // Navigation : réseau SEUL. En cas de panne de réseau, la page hors ligne — jamais une page mise
  // en cache, qui porterait les chiffres d'hier.
  if (requete.mode === "navigate") {
    // `caches.match` peut résoudre `undefined` — cache vidé par le navigateur, ou installation
    // faite hors réseau (voir le `catch` de l'installation). `respondWith(undefined)` lève, et la
    // personne retrouve l'erreur brute du navigateur, ce que cette page existe pour éviter : d'où
    // ce repli minimal, écrit ici, qui ne dépend d'aucun cache.
    event.respondWith(
      fetch(requete)
        .catch(() => caches.match(HORS_LIGNE))
        .then((reponse) => reponse || repliHorsLigne())
    );
    return;
  }

  // Tout le reste (routes, actions, exports, documents, images rendues) : on ne s'en mêle pas.
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "RH Pâtes en Folie";
  const options = {
    body: data.body || "",
    icon: "/icons/apple-touch-icon.png",
    badge: "/icons/icon-192.png",
    tag: data.tag,
    renotify: Boolean(data.tag),
    data: { url: data.url || "/accueil" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/accueil";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ("focus" in w) {
          if ("navigate" in w) w.navigate(url).catch(() => {});
          return w.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    }),
  );
});

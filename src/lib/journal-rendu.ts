import "server-only";

import pg from "pg";
import { after } from "next/server";
// Le magasin de requête de Next (même module que celui de `after()`, `cookies()`…) : donne la ROUTE rendue
// (« /employes/[id] », jamais l'identifiant ni les paramètres) et une clé propre à chaque requête.
import { workAsyncStorage } from "next/dist/server/app-render/work-async-storage.external";

/**
 * JOURNAL DE PERFORMANCE EN PRODUCTION (2026-10-13) — ÉTEINT par défaut.
 *
 * Allumé par la variable d'environnement `JOURNAL_RENDU=1` (Render → Environment), il écrit UNE ligne par
 * requête serveur dans les Logs, une fois la réponse partie :
 *
 *   [rendu] route=/paie genre=page ms=1840 sql=39 sql_fin_ms=1210 cpu_ms=930
 *
 *  - route       : le MOTIF de la page (« /employes/[id] ») — aucun nom, aucun identifiant, aucun paramètre ;
 *  - genre       : « page » si une page a été rendue (navigation, ou action suivie du rendu de la page),
 *                  « action/route » sinon (action serveur sans rendu, export, PDF…) ;
 *  - ms          : du début du travail serveur à la fin de l'envoi de la réponse (un client très lent
 *                  l'allonge : comparer avec sql_fin_ms) ;
 *  - sql         : allers-retours vers la base (BEGIN/COMMIT compris) ;
 *  - sql_fin_ms  : moment où la dernière requête SQL s'est terminée ;
 *  - cpu_ms      : temps CPU de TOUT le processus pendant ce temps (exact quand une seule personne
 *                  navigue ; plusieurs requêtes simultanées se le partagent).
 *
 * Coût éteint : un test de booléen par page. Allumé : un compteur par requête SQL et une ligne par requête.
 * Lecture : Render → service → Logs → rechercher « [rendu] ».
 */
export const JOURNAL_RENDU_ACTIF = process.env.JOURNAL_RENDU === "1";

export type MesureRendu = { debut: number; cpu: NodeJS.CpuUsage; sql: number; finSql: number; page: boolean };
const mesures = new WeakMap<object, MesureRendu>();

/** La ligne du journal — seulement un motif de route et des nombres. */
export function ligneJournal(route: string, m: MesureRendu, maintenant: number, cpu: NodeJS.CpuUsage): string {
  return `[rendu] route=${route} genre=${m.page ? "page" : "action/route"} ms=${Math.round(maintenant - m.debut)} sql=${m.sql} sql_fin_ms=${Math.round(m.finSql)} cpu_ms=${Math.round((cpu.user + cpu.system) / 1000)}`;
}

/** Motif de route sûr pour le journal : on ne garde que des segments de route, jamais une valeur. */
function routeSure(route: unknown): string {
  return typeof route === "string" && /^[\w\-/[\]().]*$/.test(route) ? route || "/" : "?";
}

/** La mesure de la requête en cours (créée à la première rencontre, avec sa ligne de journal en fin de réponse). */
function mesureDeLaRequete(): MesureRendu | null {
  let store: { route?: string; isStaticGeneration?: boolean } | undefined;
  try {
    store = workAsyncStorage.getStore();
  } catch {
    return null;
  }
  if (!store || store.isStaticGeneration) return null;
  let m = mesures.get(store);
  if (m) return m;
  m = { debut: performance.now(), cpu: process.cpuUsage(), sql: 0, finSql: 0, page: false };
  mesures.set(store, m);
  const route = routeSure(store.route);
  const mesure = m;
  try {
    after(() => {
      console.log(ligneJournal(route, mesure, performance.now(), process.cpuUsage(mesure.cpu)));
    });
  } catch {
    // Hors d'une requête (ne devrait pas arriver ici) : pas de ligne, jamais d'erreur pour la page.
  }
  return m;
}

let compteurInstalle = false;
/** Compte chaque aller-retour SQL (au niveau du pilote `pg`, sous Prisma) de la requête en cours. */
function installerCompteurSql() {
  if (compteurInstalle) return;
  compteurInstalle = true;
  const proto = pg.Client.prototype as unknown as { query: (...a: unknown[]) => unknown };
  const query = proto.query;
  proto.query = function (this: unknown, ...args: unknown[]) {
    const m = mesureDeLaRequete();
    if (!m) return query.apply(this, args);
    m.sql++;
    const fin = () => {
      m.finSql = performance.now() - m.debut;
    };
    const dernier = args[args.length - 1];
    if (typeof dernier === "function") {
      args[args.length - 1] = function (this: unknown, ...r: unknown[]) {
        fin();
        return (dernier as (...x: unknown[]) => unknown).apply(this, r);
      };
      return query.apply(this, args);
    }
    const res = query.apply(this, args);
    // Observation seulement : la promesse rendue à Prisma est l'ORIGINALE (rejet compris).
    if (res && typeof (res as Promise<unknown>).then === "function") (res as Promise<unknown>).then(fin, fin);
    return res;
  };
}

/** Appelée en tête de chaque garde de page (`lib/garde-page`) : la requête en cours est un rendu de page. */
export function noterRenduDePage() {
  if (!JOURNAL_RENDU_ACTIF) return;
  installerCompteurSql();
  const m = mesureDeLaRequete();
  if (m) m.page = true;
}

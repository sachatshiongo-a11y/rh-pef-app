import type { PrismaClient } from "@prisma/client";

// ESPION D'ÉCRITURES (tests des envois automatiques du Stock, 2026-10-12) : un client Prisma qui LAISSE PASSER
// les lectures et REFUSE (en l'enregistrant) toute écriture — create, update, delete, upsert, createMany, SQL brut
// qui ne commence pas par SELECT / WITH, transaction. Les courriels automatiques ne doivent rien écrire dans les
// données du Stock : si l'un d'eux essaie, le test échoue avec le nom de l'appel fautif.

const ECRITURES = new Set(["create", "createMany", "createManyAndReturn", "update", "updateMany", "upsert", "delete", "deleteMany"]);

export type Espion = {
  client: PrismaClient;
  /** Appels refusés (« user.update »…). Doit rester vide. */
  refus: string[];
  /** Nombre d'appels de lecture passés à la base (0 = la base n'a pas été touchée). */
  lectures: number;
  /** Désactive la surveillance (préparation des données du test). */
  actif: boolean;
};

export function creerEspion(): Espion {
  const e: Espion = { client: undefined as unknown as PrismaClient, refus: [], lectures: 0, actif: false };
  return e;
}

/** Le proxy à renvoyer comme `prisma` dans `vi.mock("@/lib/prisma", …)`. */
export function proxyEspion(e: Espion): PrismaClient {
  const sql = (strings: unknown): string => {
    if (Array.isArray(strings)) return strings.join("?");
    const s = strings as { sql?: string; strings?: string[] };
    return s.sql ?? s.strings?.join("?") ?? "";
  };
  return new Proxy({}, {
    get: (_t, p) => {
      const brut = (e.client as unknown as Record<string | symbol, unknown>)[p];
      if (!e.actif || typeof p !== "string") return typeof brut === "function" ? (brut as (...a: unknown[]) => unknown).bind(e.client) : brut;
      if (p === "$transaction" || p === "$executeRaw" || p === "$executeRawUnsafe") {
        return () => { e.refus.push(p); throw new Error(`écriture interdite : ${p}`); };
      }
      if (p === "$queryRaw" || p === "$queryRawUnsafe") {
        return (strings: unknown, ...valeurs: unknown[]) => {
          if (!/^\s*(select|with)\b/i.test(sql(strings))) { e.refus.push(`${p} (${sql(strings).slice(0, 40)})`); throw new Error(`écriture interdite : ${p}`); }
          e.lectures++;
          return (brut as (...a: unknown[]) => unknown).call(e.client, strings, ...valeurs);
        };
      }
      if (typeof brut === "function") return (brut as (...a: unknown[]) => unknown).bind(e.client);
      if (brut && typeof brut === "object") {
        return new Proxy(brut as object, {
          get: (t, q) => {
            const f = (t as Record<string | symbol, unknown>)[q];
            if (typeof q === "string" && ECRITURES.has(q)) return () => { e.refus.push(`${p}.${q}`); throw new Error(`écriture interdite : ${p}.${q}`); };
            if (typeof f === "function") return (...a: unknown[]) => { e.lectures++; return (f as (...b: unknown[]) => unknown).apply(t, a); };
            return f;
          },
        });
      }
      return brut;
    },
  }) as unknown as PrismaClient;
}

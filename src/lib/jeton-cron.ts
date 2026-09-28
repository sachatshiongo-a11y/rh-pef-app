import "server-only";
import { timingSafeEqual } from "node:crypto";

/**
 * Jeton des déclencheurs planifiés (`app/api/cron/*`). Ces routes sont PUBLIQUES au sens de la
 * session (appelées par GitHub Actions, exclues du proxy d'authentification) : c'est ce jeton
 * partagé `CRON_SECRET` qui les garde — en-tête `Authorization: Bearer …` ou `?token=`.
 * Sans `CRON_SECRET` configuré, TOUT est refusé.
 */
export function jetonCronValide(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const fourni =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ??
    new URL(request.url).searchParams.get("token") ??
    "";
  const a = Buffer.from(fourni);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

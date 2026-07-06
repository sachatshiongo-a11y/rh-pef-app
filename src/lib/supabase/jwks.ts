import "server-only";
import type { JWK } from "@supabase/auth-js";

/**
 * Cache mémoire (niveau module, partagé par tout le process `next start`) des clés publiques
 * JWKS servant à vérifier la signature des jetons Supabase.
 *
 * Sans ça, `supabase.auth.getClaims()` retélécharge le JWKS sur le réseau à CHAQUE appel, car
 * un nouveau client Supabase est créé par requête (le cache interne du client est donc toujours
 * vide). En passant ces clés à `getClaims(token, { keys })`, la vérification devient 100 % locale :
 * le réseau n'est sollicité qu'une fois par démarrage de serveur (puis toutes les 6 h).
 */
let cache: { keys: JWK[]; at: number } | null = null;
const TTL_MS = 6 * 60 * 60 * 1000; // 6 h

export async function getJwksKeys(): Promise<JWK[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.keys;
  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/.well-known/jwks.json`,
      { headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! } }
    );
    const data = (await res.json()) as { keys?: JWK[] };
    if (data?.keys?.length) {
      cache = { keys: data.keys, at: Date.now() };
    }
  } catch {
    // Réseau indisponible : on garde le cache existant s'il y en a un ; sinon [] et getClaims
    // retombera sur son propre fetch (comportement d'origine, jamais moins sûr).
  }
  return cache?.keys ?? [];
}

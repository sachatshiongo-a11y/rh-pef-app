/**
 * À la DÉCONNEXION, l'appareil cesse de recevoir les notifications du compte (audit du 10/10/2026,
 * sécurité 7) : sans cela, un téléphone partagé ou rendu continuait d'afficher les notifications
 * (congés, paie, stock) de la personne déconnectée. L'abonnement est retiré côté serveur PUIS côté
 * navigateur. Fonction PURE (dépendances injectées) : ce dépôt n'a pas de DOM en test.
 *
 * Jamais bloquante : une erreur ou une lenteur (service worker absent, réseau du VPN) ne retient
 * pas la déconnexion au-delà de `delaiMs`.
 */
export type AbonnementNavigateur = { endpoint: string; unsubscribe: () => Promise<boolean> };

export async function oublierAbonnementPush(d: {
  abonnementCourant: () => Promise<AbonnementNavigateur | null | undefined>;
  supprimerCoteServeur: (endpoint: string) => Promise<unknown>;
  delaiMs?: number;
}): Promise<"oublie" | "aucun" | "echec"> {
  const travail = (async () => {
    const sub = await d.abonnementCourant();
    if (!sub) return "aucun" as const;
    await d.supprimerCoteServeur(sub.endpoint);
    await sub.unsubscribe();
    return "oublie" as const;
  })();
  const delai = new Promise<"echec">((ok) => setTimeout(() => ok("echec"), d.delaiMs ?? 3000));
  try {
    return await Promise.race([travail, delai]);
  } catch {
    return "echec";
  }
}

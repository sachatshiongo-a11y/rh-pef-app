import "server-only";

import { cache } from "react";
import { prisma } from "@/lib/prisma";

/**
 * LA LIGNE Config, lue UNE fois par rendu serveur (React.cache) au lieu d'une fois par lecteur (13/10/2026).
 *
 * Un même affichage la lisait jusqu'à quatre fois : le layout (interrupteur de l'espace salarié, compteurs
 * « À valider », alerte de clôture de la cloche) puis la page. Sur l'offre gratuite de Render (0,1 vCPU),
 * chaque requête Prisma évitée est du temps de réponse gagné.
 *
 * La portée de `cache` est le RENDU d'une requête : deux requêtes ne partagent jamais la valeur, et une
 * action serveur ou une route (hors rendu) relit la base à chaque appel. Ne pas l'utiliser dans une
 * transaction : elle lit hors transaction.
 */
export const lireConfigDuRendu = cache(() => prisma.config.findUnique({ where: { id: "singleton" } }));

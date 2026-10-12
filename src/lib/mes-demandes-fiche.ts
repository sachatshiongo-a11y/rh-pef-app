import "server-only";

import { prisma } from "@/lib/prisma";
import { jourKinshasa } from "@/lib/heure-kinshasa";
import { lireChangements, ligneChangement } from "@/lib/fiche-sensible";
import type { DecisionVue } from "@/components/dernieres-decisions";

/**
 * « À valider » d'un rôle qui n'est pas la Direction : la réponse à SES demandes de fiche (modifications
 * de champs sensibles et créations) déjà traitées — statut et motif du refus. Seulement celles dont il
 * est l'auteur : jamais la demande d'un autre. Les plus récentes d'abord.
 */
export async function chargerMesDemandesFicheTraitees(auteurId: string, take = 15): Promise<DecisionVue[]> {
  const [modifs, creations] = await Promise.all([
    prisma.demandeModifFiche.findMany({
      where: { auteurId, statut: { not: "EN_ATTENTE" } }, orderBy: { updatedAt: "desc" }, take,
      include: { employee: { select: { nom: true } } },
    }),
    prisma.demandeCreationFiche.findMany({ where: { auteurId, statut: { not: "EN_ATTENTE" } }, orderBy: { updatedAt: "desc" }, take }),
  ]);
  const quand = (d: Date | null) => (d ? jourKinshasa(d) : "—");
  const apres = (d: { createdAt: Date; decideLe: Date | null; decideurNom: string | null }) =>
    `demandée le ${quand(d.createdAt)} · décidée par ${d.decideurNom ?? "la Direction"} le ${quand(d.decideLe)}`;
  const vues = [
    ...modifs.map((d) => {
      let lignes: string[];
      try { lignes = lireChangements(d.changements).map(ligneChangement); } catch { lignes = ["Demande illisible"]; }
      return { quand: d.updatedAt, vue: { id: d.id, resume: `${d.employee.nom} — ${lignes.join(" ; ")}`, detail: `Modification de fiche · ${apres(d)}`, statut: d.statut, motifRefus: d.motifRefus } };
    }),
    ...creations.map((d) => ({
      quand: d.updatedAt,
      vue: { id: d.id, resume: `Nouvelle fiche : ${d.nom}`, detail: `Création de fiche · ${apres(d)}`, statut: d.statut, motifRefus: d.motifRefus },
    })),
  ];
  return vues.sort((a, b) => b.quand.getTime() - a.quand.getTime()).slice(0, take).map((v) => v.vue);
}

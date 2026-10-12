"use server";

import { prisma } from "@/lib/prisma";
import { verifySession, requireRole } from "@/lib/auth";
import { erreurDeRedirection, estRedirectionNext } from "@/lib/erreur-formulaire";
import { messageLisible } from "@/lib/erreur-metier";
import { approuverChangementShift, refuserChangementShift, approuverEchange, refuserEchange } from "./actions";

// Décisions GROUPÉES sur les échanges et les changements de shift (écran « À valider »). Chaque demande
// passe par l'action INDIVIDUELLE de ./actions (mêmes règles : verrou de paie, notifications, journal) ;
// le refus de l'une (période de paie verrouillée…) n'interrompt pas les autres et NOMME la demande refusée.

export type RapportLotShifts = { traitees: number; echecs: string[] };

/** Même plafond que les autres décisions groupées (congés) : un lot reste un geste de quelques secondes. */
const MAX_DECISIONS_SHIFT_PAR_LOT = 100;

type Decision = (id: string) => Promise<void>;

async function enLot(ids: string[], decider: Decision, nommer: (ids: string[]) => Promise<Map<string, string>>): Promise<RapportLotShifts> {
  const user = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);
  const uniques = [...new Set(ids)];
  if (uniques.length === 0) return { traitees: 0, echecs: [] };
  if (uniques.length > MAX_DECISIONS_SHIFT_PAR_LOT) {
    return { traitees: 0, echecs: [`Traitez ${MAX_DECISIONS_SHIFT_PAR_LOT} demandes au plus à la fois (${uniques.length} cochées). Rien n'a été fait.`] };
  }
  const noms = await nommer(uniques);
  let traitees = 0;
  const echecs: string[] = [];
  for (const id of uniques) {
    try {
      await decider(id);
      traitees++;
    } catch (e) {
      // Un refus explicite des actions individuelles est une redirection vers /a-valider?erreur=… : on en lit le message.
      const refus = estRedirectionNext(e) ? erreurDeRedirection(e) : null;
      if (estRedirectionNext(e) && refus === null) throw e; // redirection de réussite : jamais attendue ici, on ne l'avale pas
      echecs.push(`${noms.get(id) ?? "Demande"} : ${refus ?? messageLisible(e, "décision de shift en lot")}`);
    }
  }
  return { traitees, echecs };
}

const nomsChangements = async (ids: string[]) => new Map(
  (await prisma.demandeChangementShift.findMany({ where: { id: { in: ids } }, select: { id: true, employee: { select: { nom: true } } } })).map((d) => [d.id, d.employee.nom]),
);
const nomsEchanges = async (ids: string[]) => {
  const lignes = await prisma.echangeCreneau.findMany({ where: { id: { in: ids } }, select: { id: true, demandeurId: true, collegueId: true } });
  const employes = await prisma.employee.findMany({ where: { id: { in: lignes.flatMap((l) => [l.demandeurId, l.collegueId]) } }, select: { id: true, nom: true } });
  const nom = new Map(employes.map((e) => [e.id, e.nom]));
  return new Map(lignes.map((l) => [l.id, `${nom.get(l.demandeurId) ?? "?"} ↔ ${nom.get(l.collegueId) ?? "?"}`]));
};

export async function approuverChangementsEnLot(ids: string[]): Promise<RapportLotShifts> {
  return enLot(ids, approuverChangementShift, nomsChangements);
}
export async function refuserChangementsEnLot(ids: string[]): Promise<RapportLotShifts> {
  return enLot(ids, refuserChangementShift, nomsChangements);
}
export async function approuverEchangesEnLot(ids: string[]): Promise<RapportLotShifts> {
  return enLot(ids, approuverEchange, nomsEchanges);
}
export async function refuserEchangesEnLot(ids: string[]): Promise<RapportLotShifts> {
  return enLot(ids, refuserEchange, nomsEchanges);
}

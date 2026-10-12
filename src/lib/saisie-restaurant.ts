import "server-only";

import { derniereClotureStock, estDansPeriodeFigee } from "@/lib/cloture-stock";

// Garde commune des saisies du restaurant (comptages, commandes journalières) : mêmes règles que les
// ventes (`saisirVente`) — jour civil pur AAAA-MM-JJ valide, période de stock clôturée en lecture seule.
// Audit du 10/10/2026 : ces saisies étaient réécrivables sans trace, mois clos compris.

const DATE_ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Jour pur (UTC minuit) d'une date AAAA-MM-JJ ; lève « Date <nature> invalide. » (ex. « de comptage »). */
export function lireJourSaisie(dateIso: string, nature: string): Date {
  const d = new Date(`${dateIso}T00:00:00Z`);
  if (!DATE_ISO.test(dateIso) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== dateIso) {
    throw new Error(`Date ${nature} invalide.`);
  }
  return d;
}

/** Refuse la saisie d'un jour dont la période est clôturée (Stock → Clôture du mois). */
export async function exigerJourSaisissable(date: Date, objet: string): Promise<void> {
  const borne = await derniereClotureStock();
  if (!estDansPeriodeFigee(date, borne)) return;
  const periode = `${String(borne!.mois).padStart(2, "0")}/${borne!.annee}`;
  const jour = date.toISOString().slice(0, 10).split("-").reverse().join("/");
  throw new Error(`La période ${periode} est clôturée : ${objet} du ${jour} sont en lecture seule. (Direction : Stock → Clôture du mois pour la rouvrir.)`);
}

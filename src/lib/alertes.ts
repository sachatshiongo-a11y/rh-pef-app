import "server-only";

import { prisma } from "@/lib/prisma";

export type Alerte = {
  type: "CONGE_NON_VALIDE" | "JOUR_PAIE" | "CONTRAT" | "PERIODE_ESSAI" | "DOCUMENT" | "DECLARATION";
  niveau: "info" | "warning" | "urgent";
  message: string;
  lien?: string;
};

const JOUR_PAIE = 29; // jour de paie fixé au 29 de chaque mois

function joursAvant(date: Date): number {
  const diff = date.getTime() - Date.now();
  return Math.ceil(diff / 86_400_000);
}

/**
 * Calcule toutes les alertes à afficher (congés non validés dont la date approche,
 * rappel du jour de paie le 29, échéances contrats / périodes d'essai / documents).
 */
export async function calculerAlertes(): Promise<Alerte[]> {
  const alertes: Alerte[] = [];
  const maintenant = new Date();
  const dans30j = new Date(Date.now() + 30 * 86_400_000);

  // Toutes ces requêtes sont indépendantes : on les lance EN PARALLÈLE (Promise.all) au lieu de
  // les enchaîner. Sur un lien à forte latence, cela transforme ~5 allers-retours séquentiels en
  // un seul temps d'attente.
  const [congesEnAttente, contrats, documents, runsRecents, declarationsCnss] = await Promise.all([
    prisma.leaveRequest.findMany({
      where: { statut: "EN_ATTENTE", dateDebut: { gte: maintenant, lte: dans30j } },
      include: { employee: { select: { nom: true } } },
      orderBy: { dateDebut: "asc" },
    }),
    prisma.contrat.findMany({
      where: {
        statut: "ACTIF",
        OR: [
          { dateFin: { gte: maintenant, lte: dans30j } },
          { finPeriodeEssai: { gte: maintenant, lte: dans30j } },
        ],
      },
      include: { employee: { select: { id: true, nom: true } } },
    }),
    prisma.documentEmploye.findMany({
      where: { dateExpiration: { gte: maintenant, lte: dans30j } },
      include: { employee: { select: { id: true, nom: true } } },
    }),
    prisma.payrollRun.findMany({
      select: { mois: true, annee: true },
      orderBy: [{ annee: "desc" }, { mois: "desc" }],
      take: 3,
    }),
    prisma.declarationTaxe.findMany({
      where: { type: "CNSS" },
      select: { mois: true, annee: true, statut: true },
    }),
  ]);

  // 1. Congés EN ATTENTE dont la date de début approche (≤ 7 jours) — signalement prioritaire.
  for (const c of congesEnAttente) {
    const j = joursAvant(new Date(c.dateDebut));
    alertes.push({
      type: "CONGE_NON_VALIDE",
      niveau: j <= 3 ? "urgent" : j <= 7 ? "warning" : "info",
      message: `Congé de ${c.employee.nom} débute ${
        j <= 0 ? "aujourd'hui" : `dans ${j} jour(s)`
      } (${new Date(c.dateDebut).toLocaleDateString("fr-FR")}) mais n'est pas encore validé.`,
      lien: "/conges",
    });
  }

  // 2. Rappel du jour de paie (le 29). Fenêtre d'anticipation : 5 jours avant.
  const auj = maintenant.getDate();
  const dansLeMois = maintenant.getMonth();
  const annee = maintenant.getFullYear();
  const dernierJourMois = new Date(annee, dansLeMois + 1, 0).getDate();
  const jourPaieEffectif = Math.min(JOUR_PAIE, dernierJourMois); // si le mois n'a pas 29 jours
  if (auj >= jourPaieEffectif - 5 && auj <= jourPaieEffectif) {
    const restant = jourPaieEffectif - auj;
    alertes.push({
      type: "JOUR_PAIE",
      niveau: restant <= 1 ? "urgent" : "warning",
      message:
        restant <= 0
          ? "C'est aujourd'hui le jour de paie (29 du mois)."
          : `Jour de paie dans ${restant} jour(s) (le ${jourPaieEffectif} du mois).`,
      lien: "/paie",
    });
  }

  // 3. Contrats / périodes d'essai qui expirent sous 30 jours.
  for (const c of contrats) {
    if (c.dateFin && new Date(c.dateFin) <= dans30j && new Date(c.dateFin) >= maintenant) {
      alertes.push({
        type: "CONTRAT",
        niveau: "warning",
        message: `Contrat ${c.type} de ${c.employee.nom} expire le ${new Date(c.dateFin).toLocaleDateString("fr-FR")}.`,
        lien: `/employes/${c.employee.id}`,
      });
    }
    if (
      c.finPeriodeEssai &&
      new Date(c.finPeriodeEssai) <= dans30j &&
      new Date(c.finPeriodeEssai) >= maintenant
    ) {
      alertes.push({
        type: "PERIODE_ESSAI",
        niveau: "warning",
        message: `Période d'essai de ${c.employee.nom} se termine le ${new Date(c.finPeriodeEssai).toLocaleDateString("fr-FR")}.`,
        lien: `/employes/${c.employee.id}`,
      });
    }
  }

  // 4. Documents qui expirent sous 30 jours (carte d'identité, certificat médical...).
  for (const doc of documents) {
    alertes.push({
      type: "DOCUMENT",
      niveau: "info",
      message: `Document « ${doc.nom} » de ${doc.employee.nom} expire le ${new Date(doc.dateExpiration!).toLocaleDateString("fr-FR")}.`,
      lien: `/employes/${doc.employee.id}`,
    });
  }

  // 5. Échéance CNSS (le 15 du mois suivant la paie) : rappel si non déclarée à l'approche.
  //    On regarde les paies récentes dont l'échéance tombe dans une fenêtre [-5 j, +20 j].
  for (const r of runsRecents) {
    const echeance = new Date(
      Date.UTC(r.mois === 12 ? r.annee + 1 : r.annee, r.mois === 12 ? 0 : r.mois, 15)
    );
    const j = joursAvant(echeance);
    if (j > 20 || j < -5) continue; // hors fenêtre de rappel
    const suivi = declarationsCnss.find((d) => d.mois === r.mois && d.annee === r.annee);
    if (suivi && (suivi.statut === "DECLARE" || suivi.statut === "PAYE")) continue; // déjà traitée
    const periode = new Date(r.annee, r.mois - 1).toLocaleDateString("fr-FR", {
      month: "long",
      year: "numeric",
    });
    alertes.push({
      type: "DECLARATION",
      niveau: j < 0 ? "urgent" : j <= 5 ? "urgent" : j <= 10 ? "warning" : "info",
      message:
        j < 0
          ? `Déclaration CNSS de ${periode} en RETARD (échéance dépassée le ${echeance.toLocaleDateString("fr-FR")}).`
          : `Déclaration CNSS de ${periode} à déposer avant le ${echeance.toLocaleDateString("fr-FR")} (dans ${j} jour(s)).`,
      lien: `/declarations?mois=${r.mois}&annee=${r.annee}`,
    });
  }

  const ordre = { urgent: 0, warning: 1, info: 2 };
  alertes.sort((a, b) => ordre[a.niveau] - ordre[b.niveau]);
  return alertes;
}

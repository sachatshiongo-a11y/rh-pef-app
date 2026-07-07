import "server-only";

import { prisma } from "@/lib/prisma";
import { envoyerEmail } from "@/lib/email";
import { envoyerPush } from "@/lib/push";

export type NotificationItem = {
  id: string;
  type: string;
  message: string;
  lien: string | null;
  lu: boolean;
  createdAt: Date;
};

/** Crée une notification (cloche Direction). À appeler depuis les actions métier. */
export async function creerNotification(params: {
  type: "CONGE" | "ACOMPTE" | "CLOTURE" | "AUTRE";
  message: string;
  lien?: string;
  refId?: string;
}) {
  await prisma.notification.create({
    data: { type: params.type, message: params.message, lien: params.lien ?? null, refId: params.refId ?? null },
  });

  // Notification e-mail + push aux comptes Direction (best-effort ; no-op si non configuré).
  const admins = await prisma.user.findMany({ where: { role: "ADMIN", actif: true }, select: { id: true, email: true } });
  await Promise.all([
    envoyerEmail(
      admins.map((a) => a.email),
      `Pâtes en Folie — Gestion · ${params.message}`,
      `${params.message}\n\nConnectez-vous pour traiter la demande.`
    ),
    envoyerPush(admins.map((a) => a.id), {
      title: "Pâtes en Folie — Gestion",
      body: params.message,
      url: params.lien ?? "/a-valider",
      tag: params.refId ?? params.type,
    }),
  ]);
}

/** Supprime les notifications liées à une demande (appelée quand la demande est traitée). */
export async function supprimerNotificationsPour(refId: string) {
  await prisma.notification.deleteMany({ where: { refId } });
}

const JOUR_PAIE = 30;

/** Données de la cloche : notifications stockées récentes, nombre non lues, + alerte clôture proche. */
export async function chargerNotifications(): Promise<{
  items: NotificationItem[];
  nonLues: number;
  cloture: { message: string; jours: number } | null;
}> {
  const [items, nonLues, config] = await Promise.all([
    prisma.notification.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
    prisma.notification.count({ where: { lu: false } }),
    prisma.config.findUnique({ where: { id: "singleton" } }),
  ]);

  // Clôture proche : jours restants avant le 30 du mois courant, s'il reste des bulletins non validés.
  let cloture: { message: string; jours: number } | null = null;
  if (config) {
    const auj = new Date();
    const estMoisCourant = auj.getMonth() + 1 === config.moisCourant && auj.getFullYear() === config.anneeCourante;
    if (estMoisCourant) {
      const jours = JOUR_PAIE - auj.getDate();
      if (jours >= 0 && jours <= 5) {
        const run = await prisma.payrollRun.findUnique({
          where: { mois_annee: { mois: config.moisCourant, annee: config.anneeCourante } },
          select: { id: true },
        });
        const restants = run
          ? await prisma.payrollLine.count({ where: { payrollRunId: run.id, statutPaiement: "PAS_VALIDE" } })
          : 0;
        if (!run || restants > 0) {
          cloture = {
            jours,
            message:
              jours === 0
                ? "Clôture de la paie aujourd'hui — bulletins à finaliser."
                : `Clôture de la paie dans ${jours} j${restants ? ` — ${restants} bulletin(s) à valider` : ""}.`,
          };
        }
      }
    }
  }

  return { items, nonLues, cloture };
}

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

/** Crée une notification (cloche). `domaine` cloisonne l'affichage (RH ou STOCK). */
export async function creerNotification(params: {
  type: "CONGE" | "ACOMPTE" | "CLOTURE" | "AUTRE";
  message: string;
  lien?: string;
  refId?: string;
  domaine?: "RH" | "STOCK";
}) {
  await prisma.notification.create({
    data: { domaine: params.domaine ?? "RH", type: params.type, message: params.message, lien: params.lien ?? null, refId: params.refId ?? null },
  });

  // Notification e-mail + push aux comptes Direction (best-effort ; no-op si non configuré).
  const admins = await prisma.user.findMany({ where: { role: "ADMIN", actif: true }, select: { id: true, email: true } });
  // Lien DIRECT vers la page à traiter (demande de congé → /a-valider, etc.).
  const base = process.env.NEXT_PUBLIC_SITE_URL || "https://gestion.patesenfolie.cd";
  const urlDirecte = `${base}${params.lien ?? "/a-valider"}`;
  await Promise.all([
    envoyerEmail(
      admins.map((a) => a.email),
      `Pâtes en Folie · ${params.message}`,
      `${params.message}\n\nTraiter directement : ${urlDirecte}`
    ),
    envoyerPush(admins.map((a) => a.id), {
      title: "Pâtes en Folie",
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

/**
 * Notifie UN salarié sur sa cloche personnelle (domaine SALARIE) + push sur ses appareils.
 * Utilisé pour les événements qui le concernent : congé approuvé/refusé, planning publié.
 */
export async function notifierSalarie(
  userId: string,
  params: { type: "CONGE" | "PLANNING" | "AUTRE"; message: string; lien?: string; refId?: string },
) {
  await prisma.notification.create({
    data: { domaine: "SALARIE", destinataireUserId: userId, type: params.type, message: params.message, lien: params.lien ?? null, refId: params.refId ?? null },
  });
  await envoyerPush([userId], {
    title: "Pâtes en Folie",
    body: params.message,
    url: params.lien ?? "/espace",
    tag: params.refId ?? params.type,
  });
}

/** Résout le compte salarié ACTIF (rôle EMPLOYE) lié à une fiche employé, s'il existe. */
export async function compteSalarieDe(employeeId: string): Promise<string | null> {
  const u = await prisma.user.findUnique({ where: { employeeId }, select: { id: true, role: true, actif: true } });
  return u && u.role === "EMPLOYE" && u.actif ? u.id : null;
}

/** Charge la cloche personnelle d'un salarié (ses notifications SALARIE). */
export async function chargerNotificationsSalarie(userId: string): Promise<{ items: NotificationItem[]; nonLues: number }> {
  const [items, nonLues] = await Promise.all([
    prisma.notification.findMany({ where: { domaine: "SALARIE", destinataireUserId: userId }, orderBy: { createdAt: "desc" }, take: 20 }),
    prisma.notification.count({ where: { domaine: "SALARIE", destinataireUserId: userId, lu: false } }),
  ]);
  return { items, nonLues };
}

/** Données de la cloche pour un espace (`domaine`) : notifications récentes, non lues, + alerte clôture (RH). */
export async function chargerNotifications(domaine: "RH" | "STOCK" = "RH"): Promise<{
  items: NotificationItem[];
  nonLues: number;
  cloture: { message: string; jours: number } | null;
}> {
  const [items, nonLues, config] = await Promise.all([
    prisma.notification.findMany({ where: { domaine }, orderBy: { createdAt: "desc" }, take: 20 }),
    prisma.notification.count({ where: { domaine, lu: false } }),
    prisma.config.findUnique({ where: { id: "singleton" } }),
  ]);

  // Clôture proche : jours restants avant le 30 du mois courant, s'il reste des bulletins non validés (RH uniquement).
  let cloture: { message: string; jours: number } | null = null;
  if (config && domaine === "RH") {
    const auj = new Date();
    const estMoisCourant = auj.getMonth() + 1 === config.moisCourant && auj.getFullYear() === config.anneeCourante;
    if (estMoisCourant) {
      const jours = config.jourPaie - auj.getDate();
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

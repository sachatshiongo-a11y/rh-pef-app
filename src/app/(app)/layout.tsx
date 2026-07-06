import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import { chargerNotifications } from "@/lib/notifications";
import { AppShell } from "./app-shell";

// Cache mémoire court des compteurs de badges : évite de refaire ces requêtes à CHAQUE
// navigation (coûteux sur lien lent). 20 s de fraîcheur suffisent pour des badges d'attente.
let cacheBadges: { at: number; badges: Record<string, number> } | null = null;
const TTL_BADGES = 20_000;

async function chargerBadges(): Promise<Record<string, number>> {
  if (cacheBadges && Date.now() - cacheBadges.at < TTL_BADGES) return cacheBadges.badges;

  const config = await prisma.config.findUnique({ where: { id: "singleton" } });
  const filtreRun = config ? { payrollRun: { mois: config.moisCourant, annee: config.anneeCourante } } : {};
  const [congesEnAttente, bulletinsPasValide, bulletinsValide, acomptesEnAttente] = await Promise.all([
    prisma.leaveRequest.count({ where: { statut: "EN_ATTENTE" } }),
    prisma.payrollLine.count({ where: { statutPaiement: "PAS_VALIDE", ...filtreRun } }),
    prisma.payrollLine.count({ where: { statutPaiement: "VALIDE", ...filtreRun } }),
    prisma.acompteSalaire.count({ where: { statut: "EN_ATTENTE" } }),
  ]);
  const badges = {
    "/a-valider": congesEnAttente + bulletinsPasValide + bulletinsValide + acomptesEnAttente,
    "/conges": congesEnAttente,
    "/paie": bulletinsPasValide + bulletinsValide,
  };
  cacheBadges = { at: Date.now(), badges };
  return badges;
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await verifySession();
  const estAdmin = user.role === "ADMIN";
  const [badges, notif, moi] = await Promise.all([
    chargerBadges(),
    estAdmin ? chargerNotifications() : Promise.resolve(null),
    prisma.user.findUnique({ where: { id: user.id }, select: { employe: { select: { photoUrl: true } } } }),
  ]);
  const maPhoto = moi?.employe?.photoUrl ?? null;

  return (
    <AppShell
      badges={badges}
      userNom={user.nom}
      userRole={user.role}
      maPhoto={maPhoto}
      notif={notif ? { items: notif.items, nonLues: notif.nonLues, cloture: notif.cloture } : null}
    >
      {children}
    </AppShell>
  );
}

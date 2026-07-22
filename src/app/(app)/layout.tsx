import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { verifySession, estRH, ciblesAutresEspaces } from "@/lib/auth";
import { espaceEmployeActif } from "@/lib/espace-employe";
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
  const [congesEnAttente, bulletinsPasValide, bulletinsValide, acomptesEnAttente, changementsShift] = await Promise.all([
    prisma.leaveRequest.count({ where: { statut: "EN_ATTENTE" } }),
    prisma.payrollLine.count({ where: { statutPaiement: "PAS_VALIDE", ...filtreRun } }),
    prisma.payrollLine.count({ where: { statutPaiement: "VALIDE", ...filtreRun } }),
    prisma.acompteSalaire.count({ where: { statut: "EN_ATTENTE" } }),
    prisma.demandeChangementShift.count({ where: { statut: "EN_ATTENTE" } }),
  ]);
  const echangesEnAttente = await prisma.echangeCreneau.count({ where: { statut: "EN_ATTENTE" } });
  const badges = {
    "/a-valider": congesEnAttente + bulletinsPasValide + bulletinsValide + acomptesEnAttente + changementsShift + echangesEnAttente,
    "/conges": congesEnAttente,
    "/paie": bulletinsPasValide + bulletinsValide,
  };
  cacheBadges = { at: Date.now(), badges };
  return badges;
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await verifySession();
  // Garde de LECTURE de l'espace RH : un compte sans accès RH (ex. rôle STOCK) est renvoyé
  // vers le résolveur d'entrée, qui l'oriente vers son propre espace. Le cloisonnement ne
  // repose donc pas sur le seul masquage des liens.
  if (!estRH(user.role)) redirect("/entree");
  const [badges, notif, moi, salarieActif] = await Promise.all([
    chargerBadges(),
    chargerNotifications("RH"), // cloche pour tous les utilisateurs RH
    prisma.user.findUnique({ where: { id: user.id }, select: { employe: { select: { id: true, photoUrl: true } } } }),
    espaceEmployeActif(),
  ]);
  const maPhoto = moi?.employe?.photoUrl ?? null;
  const monEmployeId = moi?.employe?.id ?? null;

  return (
    <AppShell
      badges={badges}
      userNom={user.nom}
      userRole={user.role}
      maPhoto={maPhoto}
      employeeId={monEmployeId}
      autresEspaces={ciblesAutresEspaces(user, salarieActif, "rh")}
      notif={notif ? { items: notif.items, nonLues: notif.nonLues, cloture: notif.cloture } : null}
    >
      {children}
    </AppShell>
  );
}

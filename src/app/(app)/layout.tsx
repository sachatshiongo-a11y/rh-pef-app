import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { chargerBadgesRH } from "@/lib/a-valider-chargeurs";
import { verifySession, estRH, ciblesAutresEspaces } from "@/lib/auth";
import { espaceEmployeActif } from "@/lib/espace-employe";
import { chargerNotifications } from "@/lib/notifications";
import { AppShell } from "./app-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await verifySession();
  // Garde de LECTURE de l'espace RH : un compte sans accès RH (ex. rôle STOCK) est renvoyé
  // vers le résolveur d'entrée, qui l'oriente vers son propre espace. Le cloisonnement ne
  // repose donc pas sur le seul masquage des liens.
  if (!estRH(user.role)) redirect("/entree");
  const [badges, notif, moi, salarieActif] = await Promise.all([
    // Badges par rôle (`lib/a-valider-chargeurs.ts`) : la Direction compte toute la file « À valider »,
    // les autres leurs seules demandes — le chiffre du menu est celui de la page.
    chargerBadgesRH(user),
    // Cloche RH : notifications partagées + celles ADRESSÉES à ce compte (paie : « à payer » pour la
    // RH, « payés » / « clôturée » pour la Direction — 2026-10-01).
    chargerNotifications("RH", user.id),
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

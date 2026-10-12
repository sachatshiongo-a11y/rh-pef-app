import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { chargerBadgesRH } from "@/lib/a-valider-chargeurs";
import { verifySession, estRH, ciblesAutresEspaces } from "@/lib/auth";
import { espaceEmployeActif } from "@/lib/espace-employe";
import { chargerNotificationsCompte } from "@/lib/notifications";
import { AppShell } from "./app-shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await verifySession();
  // Garde de LECTURE de l'espace RH : un compte sans accès RH (ex. rôle STOCK) est renvoyé
  // vers le résolveur d'entrée, qui l'oriente vers son propre espace. Le cloisonnement ne
  // repose donc pas sur le seul masquage des liens.
  if (!estRH(user.role)) redirect("/entree");
  const [badges, notif, moi, salarieActif] = await Promise.all([
    // Badges (`lib/a-valider-chargeurs.ts`) : « À valider » = le total de TOUS les espaces du compte (la Direction
    // compte toute la file, les autres leurs seules demandes), le chiffre de la page ; « Congés » et « Paie » : à la RH.
    chargerBadgesRH(user),
    // LA cloche unique : les notifications de tous les espaces du compte (RH, Stock, Exploitation selon ses droits)
    // + celles qui lui sont ADRESSÉES (paie : « à payer » pour la RH, « payés » / « clôturée » pour la Direction).
    chargerNotificationsCompte(user),
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

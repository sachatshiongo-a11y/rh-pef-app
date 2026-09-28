import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { verifySession, estSalarie, ciblesAutresEspaces } from "@/lib/auth";
import { espaceEmployeActif } from "@/lib/espace-employe";
import { prisma } from "@/lib/prisma";
import { chargerNotificationsSalarie } from "@/lib/notifications";
import { EspaceShell } from "./espace-shell";

// Le manifeste PWA de l'espace salarié : l'application installée depuis cet espace s'ouvre sur
// /espace, pas sur /accueil (l'accueil de la Direction, qui renvoyait le salarié ailleurs par deux
// redirections). Public comme /manifest.json — voir src/proxy.ts et chemins-publics.test.ts.
export const metadata: Metadata = { manifest: "/manifest-espace.json" };

// Espace salarié (self-service). Garde stricte : la fonctionnalité doit être ACTIVÉE et le compte
// doit être opérationnel (EMPLOYE/STOCK) relié à une fiche. Sinon → résolveur d'entrée.
export default async function EspaceLayout({ children }: { children: React.ReactNode }) {
  const user = await verifySession();
  const salarieActif = await espaceEmployeActif();
  if (!salarieActif || !estSalarie(user)) redirect("/entree");

  const [compte, notifs] = await Promise.all([
    prisma.user.findUnique({
      where: { id: user.id },
      select: { motDePasseTemporaire: true, employe: { select: { nom: true, matricule: true, photoUrl: true } } },
    }),
    chargerNotificationsSalarie(user.id),
  ]);
  const emp = compte?.employe;

  return (
    <EspaceShell
      nom={emp?.nom ?? user.nom}
      matricule={emp?.matricule ?? null}
      photoUrl={emp?.photoUrl ?? null}
      notifs={notifs}
      autresEspaces={ciblesAutresEspaces(user, salarieActif, "salarie")}
      // Mot de passe temporaire : seul le formulaire de changement est accessible (les pages le
      // renvoient toutes), on ne montre donc pas un menu qui n'y mènerait pas.
      navigation={!compte?.motDePasseTemporaire}
    >
      {children}
    </EspaceShell>
  );
}

import { redirect } from "next/navigation";
import { verifySession, estSalarie } from "@/lib/auth";
import { espaceEmployeActif } from "@/lib/espace-employe";
import { prisma } from "@/lib/prisma";
import { chargerNotificationsSalarie } from "@/lib/notifications";
import { EspaceShell } from "./espace-shell";

// Espace salarié (self-service). Garde stricte : la fonctionnalité doit être ACTIVÉE et le compte
// doit être opérationnel (EMPLOYE/STOCK) relié à une fiche. Sinon → résolveur d'entrée.
export default async function EspaceLayout({ children }: { children: React.ReactNode }) {
  const user = await verifySession();
  if (!(await espaceEmployeActif()) || !estSalarie(user)) redirect("/entree");

  const [compte, notifs] = await Promise.all([
    prisma.user.findUnique({
      where: { id: user.id },
      select: { employe: { select: { nom: true, matricule: true, photoUrl: true } } },
    }),
    chargerNotificationsSalarie(user.id),
  ]);
  const emp = compte?.employe;

  const liens = [
    { href: "/espace", icone: "accueil", label: "Accueil" },
    { href: "/espace/pointer", icone: "horloge", label: "Pointer" },
    { href: "/espace/planning", icone: "calendrier", label: "Planning & heures" },
    { href: "/espace/echanges", icone: "echanges", label: "Échanges de shift" },
    { href: "/espace/paie", icone: "billet", label: "Ma paie" },
    { href: "/espace/conges", icone: "parasol", label: "Congés" },
    { href: "/espace/dossier", icone: "dossier", label: "Dossier" },
    { href: "/espace/documents", icone: "document", label: "Documents" },
  ];

  return (
    <EspaceShell liens={liens} nom={emp?.nom ?? user.nom} matricule={emp?.matricule ?? null} photoUrl={emp?.photoUrl ?? null} notifs={notifs}>
      {children}
    </EspaceShell>
  );
}

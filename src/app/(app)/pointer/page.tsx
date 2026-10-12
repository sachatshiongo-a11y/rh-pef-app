import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { CompteNonLie } from "@/components/pointage/compte-non-lie";
import { PointerClient } from "./pointer-client";
import { chargerPointageDuJour } from "./pointage-du-jour";
import { exigerPageRH } from "@/lib/garde-page";
import { espaceEmployeActif } from "@/lib/espace-employe";

export default async function PointerPage() {
  const user = await exigerPageRH();
  const peutGerer = user.role === "ADMIN" || user.role === "MANAGER";
  const u = await prisma.user.findUnique({ where: { id: user.id }, select: { employeeId: true } });

  const lienSuivi = peutGerer ? (
    <div className="mx-auto mb-3 max-w-md text-right">
      <Link href="/pointer/suivi" className="text-sm text-primary underline">Suivi des pointages (Direction) →</Link>
    </div>
  ) : null;

  // Le pointage par l'affiche suit l'interrupteur de l'espace salarié (le serveur refuse aussi le scan).
  if (!(await espaceEmployeActif())) {
    return (
      <div className="mx-auto max-w-md">
        {lienSuivi}
        <h1 className="mb-3 text-xl font-semibold sm:text-2xl">Pointer</h1>
        <div className="rounded-2xl border border-dashed bg-card p-6 text-sm text-muted-foreground">
          Le pointage par l&apos;affiche est fermé : l&apos;espace salarié est désactivé (Paramètres). Les présences se saisissent dans « Présences &amp; heures ».
        </div>
      </div>
    );
  }

  if (!u?.employeeId) {
    return (
      <div className="mx-auto max-w-md">
        {lienSuivi}
        <h1 className="mb-3 text-xl font-semibold sm:text-2xl">Pointer</h1>
        <CompteNonLie />
      </div>
    );
  }

  const jour = await chargerPointageDuJour(u.employeeId);

  return (
    <>
      {lienSuivi}
      <PointerClient
        nom={jour.nom ?? "—"}
        photoUrl={jour.photoUrl}
        dateLabel={jour.dateLabel}
        pointage={jour.pointage}
        departScanne={jour.departScanne}
      />
    </>
  );
}

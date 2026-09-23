import Link from "next/link";
import { verifySession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { CompteNonLie } from "@/components/pointage/compte-non-lie";
import { PointerClient } from "./pointer-client";
import { chargerPointageDuJour } from "./pointage-du-jour";

export default async function PointerPage() {
  const user = await verifySession();
  const peutGerer = user.role === "ADMIN" || user.role === "MANAGER";
  const u = await prisma.user.findUnique({ where: { id: user.id }, select: { employeeId: true } });

  const lienSuivi = peutGerer ? (
    <div className="mx-auto mb-3 max-w-md text-right">
      <Link href="/pointer/suivi" className="text-sm text-primary underline">Suivi des pointages (Direction) →</Link>
    </div>
  ) : null;

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

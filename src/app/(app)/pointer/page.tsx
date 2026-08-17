import Link from "next/link";
import { verifySession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { PointerClient } from "./pointer-client";

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
        <div className="rounded-2xl border border-dashed bg-card p-6 text-sm text-muted-foreground">
          Votre compte n'est pas encore lié à une fiche employé. Demandez à la Direction de faire le lien
          (Paramètres → Utilisateurs) pour pouvoir pointer vos heures.
        </div>
      </div>
    );
  }

  // « Aujourd'hui » en heure de Kinshasa (UTC+1) → DATE à minuit UTC, cohérent avec les présences.
  const k = new Date(Date.now() + 3_600_000);
  const date = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()));

  const [emp, p] = await Promise.all([
    prisma.employee.findUnique({ where: { id: u.employeeId }, select: { nom: true, photoUrl: true } }),
    prisma.pointage.findUnique({ where: { employeeId_date: { employeeId: u.employeeId, date } } }),
  ]);

  const dateLabel = k.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  const pointage = p
    ? { heureDebut: p.heureDebut.toISOString(), heureFin: p.heureFin ? p.heureFin.toISOString() : null, pauseMinutes: p.pauseMinutes }
    : null;

  return (
    <>
      {lienSuivi}
      <PointerClient nom={emp?.nom ?? "—"} photoUrl={emp?.photoUrl ?? null} dateLabel={dateLabel} pointage={pointage} />
    </>
  );
}

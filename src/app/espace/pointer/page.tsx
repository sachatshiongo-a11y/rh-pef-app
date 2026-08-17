import { prisma } from "@/lib/prisma";
import { chargerSalarie } from "../garde";
import { PointerClient } from "@/app/(app)/pointer/pointer-client";

// Pointage self-service du salarié depuis son espace (réutilise le composant et les actions existants).
export default async function EspacePointer() {
  const s = await chargerSalarie();

  // « Aujourd'hui » en heure de Kinshasa (UTC+1) → DATE à minuit UTC, cohérent avec les présences.
  const k = new Date(Date.now() + 3_600_000);
  const date = new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()));

  const [emp, p] = await Promise.all([
    prisma.employee.findUnique({ where: { id: s.employeeId }, select: { nom: true, photoUrl: true } }),
    prisma.pointage.findUnique({ where: { employeeId_date: { employeeId: s.employeeId, date } } }),
  ]);

  const dateLabel = k.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  const pointage = p
    ? { heureDebut: p.heureDebut.toISOString(), heureFin: p.heureFin ? p.heureFin.toISOString() : null, pauseMinutes: p.pauseMinutes }
    : null;

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">Pointer</h1>
      <PointerClient nom={emp?.nom ?? s.nom} photoUrl={emp?.photoUrl ?? null} dateLabel={dateLabel} pointage={pointage} />
    </div>
  );
}

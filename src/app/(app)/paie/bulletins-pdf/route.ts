import { renderToBuffer } from "@react-pdf/renderer";
import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import { BulletinsDocument } from "@/lib/pdf/bulletin";
import type { Devise } from "@/lib/pdf/theme";

/** Tous les bulletins du mois courant dans UN seul PDF (une page par employé). */
export async function GET(request: Request) {
  await verifySession();
  const devise: Devise = new URL(request.url).searchParams.get("devise") === "CDF" ? "CDF" : "USD";

  const config = await prisma.config.findUniqueOrThrow({ where: { id: "singleton" } });
  const mois = config.moisCourant;
  const annee = config.anneeCourante;

  const run = await prisma.payrollRun.findUnique({
    where: { mois_annee: { mois, annee } },
    include: { lignes: { include: { employee: true }, orderBy: { employee: { nom: "asc" } } } },
  });
  if (!run || run.lignes.length === 0) {
    return new Response("Aucune paie calculée pour ce mois", { status: 404 });
  }

  const debutMois = new Date(Date.UTC(annee, mois - 1, 1));
  const finMois = new Date(Date.UTC(annee, mois, 0));
  const [conges, attendances, primes] = await Promise.all([
    prisma.leaveRequest.findMany({
      where: { statut: "APPROUVE", dateDebut: { lte: finMois }, dateFin: { gte: debutMois } },
    }),
    prisma.attendance.findMany({ where: { date: { gte: debutMois, lte: finMois } } }),
    prisma.prime.findMany({ where: { mois, annee }, orderBy: { createdAt: "asc" } }),
  ]);
  const congesParEmp = new Map<string, { dateDebut: Date; dateFin: Date }[]>();
  for (const c of conges)
    (congesParEmp.get(c.employeeId) ?? congesParEmp.set(c.employeeId, []).get(c.employeeId)!).push({
      dateDebut: new Date(c.dateDebut),
      dateFin: new Date(c.dateFin),
    });
  const codesParEmp = new Map<string, Record<number, string>>();
  for (const a of attendances) {
    const map = codesParEmp.get(a.employeeId) ?? codesParEmp.set(a.employeeId, {}).get(a.employeeId)!;
    map[new Date(a.date).getUTCDate()] = a.code;
  }
  const primesParEmp = new Map<string, { nom: string; montantUSD: number }[]>();
  for (const p of primes)
    (primesParEmp.get(p.employeeId) ?? primesParEmp.set(p.employeeId, []).get(p.employeeId)!).push({
      nom: p.nom,
      montantUSD: Number(p.montantUSD),
    });

  const bulletins = run.lignes.map((l) => ({
    employee: l.employee,
    ligne: l,
    run,
    congesPeriode: congesParEmp.get(l.employeeId) ?? [],
    primes: primesParEmp.get(l.employeeId) ?? [],
    codesParJour: codesParEmp.get(l.employeeId) ?? {},
  }));

  const buffer = await renderToBuffer(BulletinsDocument({ bulletins, devise }));
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="Bulletins_${annee}-${String(mois).padStart(2, "0")}_${devise}.pdf"`,
    },
  });
}

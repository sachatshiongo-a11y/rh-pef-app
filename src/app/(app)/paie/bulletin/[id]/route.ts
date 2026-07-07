import { renderToBuffer } from "@react-pdf/renderer";
import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import { BulletinDocument } from "@/lib/pdf/bulletin";
import type { Devise } from "@/lib/pdf/theme";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  await verifySession();
  const { id } = await params;
  const url = new URL(request.url);
  const devise: Devise = url.searchParams.get("devise") === "CDF" ? "CDF" : "USD";
  // ?dl=1 → téléchargement direct ; sinon affichage inline (aperçu).
  const telecharger = url.searchParams.get("dl") === "1";

  const ligne = await prisma.payrollLine.findUnique({
    where: { id },
    include: { employee: true, payrollRun: true },
  });
  if (!ligne) {
    return new Response("Bulletin introuvable", { status: 404 });
  }

  const debutMois = new Date(Date.UTC(ligne.payrollRun.annee, ligne.payrollRun.mois - 1, 1));
  const finMois = new Date(Date.UTC(ligne.payrollRun.annee, ligne.payrollRun.mois, 0));
  const [congesApprouves, attendances, primes] = await Promise.all([
    prisma.leaveRequest.findMany({
      where: {
        employeeId: ligne.employeeId,
        statut: "APPROUVE",
        dateDebut: { lte: finMois },
        dateFin: { gte: debutMois },
      },
    }),
    prisma.attendance.findMany({
      where: { employeeId: ligne.employeeId, date: { gte: debutMois, lte: finMois } },
    }),
    prisma.prime.findMany({
      where: { employeeId: ligne.employeeId, mois: ligne.payrollRun.mois, annee: ligne.payrollRun.annee },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const codesParJour: Record<number, string> = {};
  for (const a of attendances) codesParJour[new Date(a.date).getUTCDate()] = a.code;

  const buffer = await renderToBuffer(
    BulletinDocument({
      employee: ligne.employee,
      ligne,
      run: ligne.payrollRun,
      devise,
      congesPeriode: congesApprouves.map((c) => ({
        dateDebut: new Date(c.dateDebut),
        dateFin: new Date(c.dateFin),
      })),
      primes: primes.map((p) => ({ nom: p.nom, montantUSD: Number(p.montantUSD) })),
      codesParJour,
    })
  );

  const nomFichier = `Bulletin_${ligne.employee.matricule}_${ligne.payrollRun.annee}-${String(ligne.payrollRun.mois).padStart(2, "0")}_${devise}.pdf`;
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${telecharger ? "attachment" : "inline"}; filename="${nomFichier}"`,
    },
  });
}

import { renderPdfBuffer } from "@/lib/pdf/fonts";
import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import { BulletinsDocument } from "@/lib/pdf/bulletin";
import { chargerDonneesBulletinsDuMois } from "@/lib/paie-bulletins";
import type { Devise } from "@/lib/pdf/theme";

/** Tous les bulletins du mois courant dans UN seul PDF (une page par employé). */
export async function GET(request: Request) {
  await verifySession();
  const devise: Devise = new URL(request.url).searchParams.get("devise") === "CDF" ? "CDF" : "USD";

  const config = await prisma.config.findUniqueOrThrow({ where: { id: "singleton" } });
  const mois = config.moisCourant;
  const annee = config.anneeCourante;

  const donnees = await chargerDonneesBulletinsDuMois(mois, annee);
  if (!donnees) {
    return new Response("Aucune paie calculée pour ce mois", { status: 404 });
  }
  const { run, feries, congesParEmp, codesParEmp, primesParEmp, entreprise, logo, parametres } = donnees;

  const bulletins = run.lignes.map((l) => ({
    employee: l.employee,
    ligne: l,
    run,
    congesPeriode: congesParEmp.get(l.employeeId) ?? [],
    primes: primesParEmp.get(l.employeeId) ?? [],
    codesParJour: codesParEmp.get(l.employeeId) ?? {},
    feries,
    entreprise,
    logo,
    params: parametres,
  }));

  const buffer = await renderPdfBuffer(BulletinsDocument({ bulletins, devise }));
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="Bulletins_${annee}-${String(mois).padStart(2, "0")}_${devise}.pdf"`,
    },
  });
}

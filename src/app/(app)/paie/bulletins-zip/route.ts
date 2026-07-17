import { renderToBuffer } from "@react-pdf/renderer";
import JSZip from "jszip";
import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import { BulletinDocument } from "@/lib/pdf/bulletin";
import { chargerEntreprise } from "@/lib/entreprise";
import type { Devise } from "@/lib/pdf/theme";

/** Tous les bulletins du mois courant, un fichier PDF SÉPARÉ par employé, regroupés dans un ZIP. */
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
  const [conges, attendances, primes, feriesRows] = await Promise.all([
    prisma.leaveRequest.findMany({
      where: { statut: "APPROUVE", dateDebut: { lte: finMois }, dateFin: { gte: debutMois } },
    }),
    prisma.attendance.findMany({ where: { date: { gte: debutMois, lte: finMois } } }),
    prisma.prime.findMany({ where: { mois, annee }, orderBy: { createdAt: "asc" } }),
    prisma.jourFerie.findMany({ select: { date: true } }),
  ]);
  const feries = feriesRows.map((f) => new Date(f.date).toISOString().slice(0, 10));
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

  const periode = `${annee}-${String(mois).padStart(2, "0")}`;
  const slug = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");

  const ent = await chargerEntreprise();
  const zip = new JSZip();
  const utilises = new Set<string>();
  for (const l of run.lignes) {
    const buffer = await renderToBuffer(
      BulletinDocument({
        employee: l.employee,
        ligne: l,
        run,
        devise,
        congesPeriode: congesParEmp.get(l.employeeId) ?? [],
        primes: primesParEmp.get(l.employeeId) ?? [],
        codesParJour: codesParEmp.get(l.employeeId) ?? {},
        feries,
        entreprise: ent.entreprise,
        logo: ent.logo,
      })
    );
    let nom = `${slug(l.employee.nom) || l.employee.matricule || l.employeeId}_${periode}_${devise}`;
    // Évite les collisions de noms de fichiers (homonymes).
    let suffixe = 1;
    let candidat = nom;
    while (utilises.has(candidat)) candidat = `${nom}_${++suffixe}`;
    nom = candidat;
    utilises.add(nom);
    zip.file(`${nom}.pdf`, buffer);
  }

  const contenu = await zip.generateAsync({ type: "nodebuffer" });
  return new Response(new Uint8Array(contenu), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="Bulletins_${periode}_${devise}_separes.zip"`,
    },
  });
}

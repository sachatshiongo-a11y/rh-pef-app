import "server-only";
import { prisma } from "@/lib/prisma";
import { lignesComptees } from "@/lib/paie-hors-calcul";
import { chargerEntreprise } from "@/lib/entreprise";
import { chargerParametresPaie } from "@/lib/config";
import type { entreprise as entrepriseDefaut } from "@/lib/pdf/theme";
import type { ImagePdf } from "@/lib/entreprise";
import type { ParametresPaie } from "@/lib/payroll";
import type { BulletinProps } from "@/lib/pdf/bulletin";
import { signaturesImprimables, type SignatureImprimable } from "@/lib/signature";
import { congesDuBulletin, type CongeBulletin, type TypeCongeInfo } from "@/lib/conges-bulletin";
import { chargerTypesCongeBulletin, congesDeLInstantane } from "@/lib/conges-bulletin-donnees";
import { fusionnerFicheFigee } from "@/lib/bulletin-fiche-figee";

export type DonneesBulletinsDuMois = {
  run: NonNullable<Awaited<ReturnType<typeof chargerRun>>>;
  feries: string[];
  congesParEmp: Map<string, { dateDebut: Date; dateFin: Date; type: string }[]>;
  typesConge: TypeCongeInfo[];
  /** Pour chaque ligne VALIDÉE ou PAYÉE : la fiche salarié et les congés figés à la dernière validation
   *  (dernier instantané). Absent = ligne sans instantané (fiche du jour, rien d'inventé). */
  figesParLigne: Map<string, { employe: Record<string, unknown> | undefined; conges: CongeBulletin[] | null }>;
  codesParEmp: Map<string, Record<number, string>>;
  primesParEmp: Map<string, { nom: string; montantUSD: number }[]>;
  entreprise: typeof entrepriseDefaut;
  logo: ImagePdf;
  /** Paramètres de paie (2026-07-22) — pour reconstituer le brut affiché sur le bulletin PDF. */
  parametres: ParametresPaie;
  /** Tracé + mention de signature, par id de ligne de paie. Absent = bulletin jamais signé. */
  signaturesParLigne: Map<string, SignatureImprimable>;
};

function chargerRun(mois: number, annee: number) {
  return prisma.payrollRun.findUnique({
    where: { mois_annee: { mois, annee } },
    include: { lignes: { include: { employee: true }, orderBy: { employee: { nom: "asc" } } } },
  });
}

/**
 * Charge les données communes aux exports de bulletins du mois (PDF groupé et ZIP séparé) :
 * le run de paie, les jours fériés, et les congés/présences/primes du mois regroupés par employé.
 * Renvoie `null` si aucune paie n'est calculée pour ce mois (aucun run ou aucune ligne).
 */
export async function chargerDonneesBulletinsDuMois(mois: number, annee: number): Promise<DonneesBulletinsDuMois | null> {
  const run = await chargerRun(mois, annee);
  // Lignes hors calcul (ligne rouverte d'un salarié sorti du calcul) : hors des exports (paie-hors-calcul.ts).
  if (run) run.lignes = await lignesComptees(prisma, run.lignes);
  if (!run || run.lignes.length === 0) return null;

  const debutMois = new Date(Date.UTC(annee, mois - 1, 1));
  const finMois = new Date(Date.UTC(annee, mois, 0));
  const idsFiges = run.lignes.filter((l) => l.statutPaiement !== "PAS_VALIDE").map((l) => l.id);
  const [conges, attendances, primes, feriesRows, ent, parametres, typesConge, versions] = await Promise.all([
    prisma.leaveRequest.findMany({
      where: { statut: "APPROUVE", dateDebut: { lte: finMois }, dateFin: { gte: debutMois } },
    }),
    prisma.attendance.findMany({ where: { date: { gte: debutMois, lte: finMois } } }),
    prisma.prime.findMany({ where: { mois, annee }, orderBy: { createdAt: "asc" } }),
    prisma.jourFerie.findMany({ select: { date: true } }),
    chargerEntreprise(),
    chargerParametresPaie(),
    chargerTypesCongeBulletin(prisma),
    // Dernier instantané de chaque ligne figée (le plus récent numéro de version par ligne).
    idsFiges.length
      ? prisma.versionBulletin.findMany({
          where: { payrollLineId: { in: idsFiges } },
          orderBy: { numeroVersion: "desc" },
          distinct: ["payrollLineId"],
          select: { payrollLineId: true, snapshot: true },
        })
      : Promise.resolve([] as { payrollLineId: string; snapshot: unknown }[]),
  ]);
  const figesParLigne: DonneesBulletinsDuMois["figesParLigne"] = new Map(
    versions.map((v) => [v.payrollLineId, { employe: (v.snapshot as { employe?: Record<string, unknown> }).employe, conges: congesDeLInstantane(v.snapshot) }]),
  );

  const feries = feriesRows.map((f) => new Date(f.date).toISOString().slice(0, 10));

  const congesParEmp = new Map<string, { dateDebut: Date; dateFin: Date; type: string }[]>();
  for (const c of conges)
    (congesParEmp.get(c.employeeId) ?? congesParEmp.set(c.employeeId, []).get(c.employeeId)!).push({
      dateDebut: new Date(c.dateDebut),
      dateFin: new Date(c.dateFin),
      type: c.type,
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

  // LES SIGNATURES DE TOUTE LA LIASSE, EN UNE FOIS.
  //
  // Sans cette ligne, un bulletin ouvert à l'unité porterait la mention de signature et le MÊME
  // bulletin sorti de l'export groupé n'en porterait aucune : la Direction imprimerait la liasse
  // du mois et distribuerait des bulletins qui paraissent non signés alors qu'ils le sont.
  // Le coût invoqué (« une requête par salarié ») n'existe pas : `signaturesImprimables` fait le
  // même nombre de requêtes pour tout l'effectif que pour un seul bulletin. Seule la lecture des
  // tracés dans le stockage est proportionnelle — et il n'y en a que pour les bulletins signés.
  const signaturesParLigne = await signaturesImprimables(prisma, "BULLETIN", run.lignes.map((l) => l.id));

  return { run, feries, congesParEmp, codesParEmp, primesParEmp, entreprise: ent.entreprise, logo: ent.logo, parametres, signaturesParLigne, typesConge, figesParLigne };
}

/**
 * Les propriétés de rendu d'un bulletin, pour CHAQUE ligne du mois — l'unique assembleur des
 * exports groupés (PDF d'un seul tenant et ZIP de PDF séparés).
 *
 * Il existe pour que les deux routes ne puissent pas diverger : recopié dans chacune, l'oubli de
 * `signatureSalarie` dans une seule des deux serait invisible jusqu'au jour où un salarié
 * comparerait son exemplaire à celui de la liasse.
 */
export function bulletinsPourPdf(donnees: DonneesBulletinsDuMois): Omit<BulletinProps, "devise">[] {
  const { run, feries, congesParEmp, codesParEmp, primesParEmp, entreprise, logo, parametres, signaturesParLigne, typesConge, figesParLigne } = donnees;
  return run.lignes.map((l) => {
    // Même règle que le bulletin à l'unité (`genererBulletinPdf`) : une ligne validée ou payée garde la
    // fiche et les congés de sa validation ; une ligne en brouillon est marquée PROVISOIRE.
    const fige = figesParLigne.get(l.id);
    return {
    employee: fige ? fusionnerFicheFigee(l.employee, fige.employe) : l.employee,
    ligne: l,
    run,
    provisoire: l.statutPaiement === "PAS_VALIDE",
    congesPeriode: fige?.conges ?? congesDuBulletin(congesParEmp.get(l.employeeId) ?? [], feries, run.mois, run.annee, typesConge),
    primes: primesParEmp.get(l.employeeId) ?? [],
    codesParJour: codesParEmp.get(l.employeeId) ?? {},
    feries,
    entreprise,
    logo,
    params: parametres,
    signatureSalarie: signaturesParLigne.get(l.id),
    };
  });
}

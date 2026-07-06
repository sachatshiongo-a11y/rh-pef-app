import { prisma } from "@/lib/prisma";
import { verifySession } from "@/lib/auth";
import { CongesInbox, type CongeRow } from "./conges-inbox";
import { BulletinsInbox, type BulletinRow } from "./bulletins-inbox";
import { AcomptesInbox, type AcompteRow } from "./acomptes-inbox";

function joursAvant(date: Date): number {
  return Math.ceil((new Date(date).getTime() - Date.now()) / 86_400_000);
}
function echeanceInfo(date: Date): { texte: string; classe: string } {
  const j = joursAvant(date);
  if (j < 0) return { texte: `en retard (${-j} j)`, classe: "text-red-600 font-medium" };
  if (j === 0) return { texte: "aujourd'hui", classe: "text-red-600 font-medium" };
  if (j <= 3) return { texte: `dans ${j} j`, classe: "text-amber-600 font-medium" };
  return { texte: `dans ${j} j`, classe: "text-muted-foreground" };
}
function money(n: number) {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " $";
}

export default async function AValiderPage() {
  const user = await verifySession();
  const peutValider = user.role === "ADMIN";

  const config = await prisma.config.findUnique({ where: { id: "singleton" } });
  const filtreRun = config
    ? { payrollRun: { mois: config.moisCourant, annee: config.anneeCourante } }
    : {};

  const [conges, prepare, valide, acomptes] = await Promise.all([
    prisma.leaveRequest.findMany({
      where: { statut: "EN_ATTENTE" },
      include: { employee: { select: { id: true, nom: true, photoUrl: true } } },
      orderBy: { dateDebut: "asc" },
    }),
    prisma.payrollLine.findMany({
      where: { statutPaiement: "PAS_VALIDE", ...filtreRun },
      include: { employee: { select: { id: true, nom: true, matricule: true, photoUrl: true } } },
      orderBy: { employee: { nom: "asc" } },
    }),
    prisma.payrollLine.findMany({
      where: { statutPaiement: "VALIDE", ...filtreRun },
      include: { employee: { select: { id: true, nom: true, matricule: true, photoUrl: true } } },
      orderBy: { employee: { nom: "asc" } },
    }),
    prisma.acompteSalaire.findMany({
      where: { statut: "EN_ATTENTE" },
      include: { employee: { select: { id: true, nom: true, photoUrl: true } } },
      orderBy: { dateDemande: "asc" },
    }),
  ]);

  const congeRows: CongeRow[] = conges.map((d) => {
    const ech = echeanceInfo(d.dateDebut);
    return {
      id: d.id,
      employeeId: d.employee.id,
      nom: d.employee.nom,
      photoUrl: d.employee.photoUrl,
      type: d.type,
      du: new Date(d.dateDebut).toLocaleDateString("fr-FR"),
      au: new Date(d.dateFin).toLocaleDateString("fr-FR"),
      jours: Number(d.nbJours),
      echeanceTexte: ech.texte,
      echeanceClasse: ech.classe,
    };
  });

  const toRow = (l: (typeof prepare)[number]): BulletinRow => ({
    id: l.id,
    employeeId: l.employee.id,
    matricule: l.employee.matricule,
    nom: l.employee.nom,
    photoUrl: l.employee.photoUrl,
    montant: money(Number(l.salNetUSD)),
  });
  const prepareRows = prepare.map(toRow);
  const valideRows = valide.map(toRow);
  const acompteRows: AcompteRow[] = acomptes.map((a) => ({
    id: a.id,
    employeeId: a.employee.id,
    nom: a.employee.nom,
    photoUrl: a.employee.photoUrl,
    montant: money(Number(a.montantUSD)),
    periode: `${String(a.mois).padStart(2, "0")}/${a.annee}`,
    motif: a.motif ?? null,
    demandeLe: new Date(a.dateDemande).toLocaleDateString("fr-FR"),
  }));
  const total = congeRows.length + prepareRows.length + valideRows.length + acompteRows.length;

  return (
    <div className="max-w-5xl">
      {/* En-tête façon Factorial : titre à gauche, grande carte compteur à droite */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">Demandes de validation</h1>
          <p className="text-sm text-muted-foreground">Demandes et bulletins en attente d&apos;action</p>
        </div>
        <div className="rounded-xl border bg-card px-6 py-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">En attente</p>
          <p className="mt-1 text-3xl font-bold">{total}</p>
        </div>
      </div>

      {!peutValider && (
        <p className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          Vous pouvez consulter les éléments en attente. La validation et le paiement sont réservés
          à la Directrice et à Sacha.
        </p>
      )}

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Demandes de congé ({congeRows.length})
        </h2>
        <CongesInbox rows={congeRows} peutValider={peutValider} />
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Demandes d&apos;acompte sur salaire ({acompteRows.length})
        </h2>
        <AcomptesInbox rows={acompteRows} peutValider={peutValider} />
      </section>

      {peutValider && (
        <>
          <section className="mb-8">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Bulletins à valider — signer ({prepareRows.length})
            </h2>
            {prepareRows.length === 0 ? (
              <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
                Aucun bulletin en attente de validation.
              </div>
            ) : (
              <BulletinsInbox rows={prepareRows} cible="VALIDE" actionLabel="Valider" />
            )}
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Bulletins à payer ({valideRows.length})
            </h2>
            {valideRows.length === 0 ? (
              <div className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
                Aucun bulletin validé en attente de paiement.
              </div>
            ) : (
              <BulletinsInbox rows={valideRows} cible="PAYE" actionLabel="Marquer payé" />
            )}
          </section>
        </>
      )}
    </div>
  );
}

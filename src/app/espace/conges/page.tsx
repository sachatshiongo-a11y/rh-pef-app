import { prisma } from "@/lib/prisma";
import { chargerSalarie } from "../garde";
import { demanderMonConge } from "../actions";
import { chargerSignatures, etatSignature } from "@/lib/signature";
import { signerMonDocument } from "../signature-actions";
import { chargerSoldeCongeSalarie } from "@/lib/solde-conge-salarie";
import { VueMesConges } from "./vue";
import { jourCourantKinshasaISO, anneeCouranteKinshasa } from "@/lib/heure-kinshasa";

export default async function EspaceConges({ searchParams }: { searchParams: Promise<{ erreur?: string; envoye?: string }> }) {
  const s = await chargerSalarie();
  const sp = await searchParams;

  const [demandes, typesConges, feriesRows, solde] = await Promise.all([
    prisma.leaveRequest.findMany({ where: { employeeId: s.employeeId }, orderBy: { dateDebut: "desc" }, take: 60 }),
    prisma.typeConge.findMany({ where: { actif: true }, orderBy: { ordre: "asc" }, select: { nom: true } }),
    prisma.jourFerie.findMany({ select: { date: true } }),
    // Même source que l'Accueil : un seul solde dans tout l'espace.
    chargerSoldeCongeSalarie(prisma, s.employeeId),
  ]);

  // Seules les demandes APPROUVÉES se signent ; une seule requête pour toutes celles affichées.
  const sigConges = await chargerSignatures(
    prisma,
    "DEMANDE_CONGE",
    demandes.filter((l) => l.statut === "APPROUVE").map((l) => l.id)
  );

  return (
    <VueMesConges
      nomSalarie={s.nom}
      solde={solde}
      annee={anneeCouranteKinshasa()}
      types={typesConges.map((t) => t.nom)}
      feries={feriesRows.map((f) => new Date(f.date).toISOString().slice(0, 10))}
      aujourdhui={jourCourantKinshasaISO()}
      envoye={!!sp.envoye}
      erreur={sp.erreur ?? null}
      demanderConge={demanderMonConge}
      signer={signerMonDocument}
      demandes={demandes.map((l) => ({
        id: l.id,
        type: l.type,
        nbJours: Number(l.nbJours),
        dateDebut: l.dateDebut,
        dateFin: l.dateFin,
        motif: l.motif,
        statut: l.statut,
        signature: l.statut === "APPROUVE" ? etatSignature(sigConges.get(l.id)) : null,
      }))}
    />
  );
}

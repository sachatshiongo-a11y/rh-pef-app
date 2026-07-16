import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { chargerSalarie } from "./garde";
import { chargerParametresPaie } from "@/lib/config";
import { calculerCongesAcquis, congeDeductibleDuSolde } from "@/lib/payroll";
import { typeSansConges } from "@/lib/regles-contrats";
import { lundiDe } from "@/lib/dates-fr";
import { Icone } from "@/components/icones";

function ancienneteEnMois(dateEmbauche: Date, ref: Date) {
  return Math.max(0, (ref.getFullYear() - dateEmbauche.getFullYear()) * 12 + (ref.getMonth() - dateEmbauche.getMonth()));
}

export default async function EspaceAccueil() {
  const s = await chargerSalarie();
  const params = await chargerParametresPaie();
  const now = new Date();
  const lundi = lundiDe(new Date(Date.now() + 3_600_000));
  const dimanche = new Date(lundi);
  dimanche.setUTCDate(dimanche.getUTCDate() + 6);

  const [emp, congesEnAttente, prochainCreneau, semainePubliee] = await Promise.all([
    prisma.employee.findUniqueOrThrow({ where: { id: s.employeeId }, select: { contrat: true, dateEmbauche: true } }),
    prisma.leaveRequest.count({ where: { employeeId: s.employeeId, statut: "EN_ATTENTE" } }),
    prisma.planningCreneau.findFirst({
      where: { employeeId: s.employeeId, date: { gte: lundi } },
      orderBy: { date: "asc" },
      select: { date: true, shift: { select: { nom: true, heureDebut: true, heureFin: true } } },
    }),
    prisma.semainePubliee.findUnique({ where: { lundi }, select: { id: true } }),
  ]);

  const anciennete = ancienneteEnMois(new Date(emp.dateEmbauche), now);
  const congesAcquis = typeSansConges(emp.contrat) ? 0 : calculerCongesAcquis(anciennete, params.droitsCongesAnnuel);
  const debutAnnee = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const congesAnnee = await prisma.leaveRequest.findMany({
    where: { employeeId: s.employeeId, statut: "APPROUVE", dateDebut: { gte: debutAnnee } },
    select: { type: true, nbJours: true },
  });
  const congesPris = congesAnnee.filter((l) => congeDeductibleDuSolde(l.type)).reduce((a, l) => a + Number(l.nbJours), 0);
  const solde = Math.round((congesAcquis - congesPris) * 10) / 10;

  const creneauVisible = semainePubliee ? prochainCreneau : null;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Bonjour {s.prenom} 👋</h1>
        <p className="text-sm text-muted-foreground">Voici votre espace personnel.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Carte titre="Solde de congés" valeur={`${solde} j`} sousTitre="jours disponibles" icone="parasol" href="/espace/conges" />
        <Carte titre="Demandes en cours" valeur={String(congesEnAttente)} sousTitre="en attente de validation" icone="valider" href="/espace/conges" />
        <Carte
          titre="Prochain service"
          valeur={creneauVisible ? (creneauVisible.shift.heureDebut ?? creneauVisible.shift.nom) : "—"}
          sousTitre={creneauVisible ? new Date(creneauVisible.date).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }) : "planning non publié"}
          icone="calendrier"
          href="/espace/planning"
        />
      </div>

      <div className="rounded-2xl border bg-card p-5">
        <h2 className="mb-3 text-base font-semibold">Accès rapides</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <LienRapide href="/espace/planning" icone="calendrier" titre="Mon planning" desc="Mes services des semaines publiées" />
          <LienRapide href="/espace/conges" icone="parasol" titre="Mes congés" desc="Demander un congé, suivre mes demandes" />
          <LienRapide href="/espace/dossier" icone="dossier" titre="Mon dossier" desc="Contrat, poste, rémunération" />
          <LienRapide href="/espace/documents" icone="document" titre="Mes documents" desc="Bulletins, contrats, attestations" />
        </div>
      </div>
    </div>
  );
}

function Carte({ titre, valeur, sousTitre, icone, href }: { titre: string; valeur: string; sousTitre: string; icone: string; href: string }) {
  return (
    <Link href={href} className="rounded-2xl border bg-card p-4 transition hover:border-primary hover:shadow-sm">
      <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground"><Icone nom={icone} className="shrink-0" /> {titre}</div>
      <div className="text-2xl font-semibold">{valeur}</div>
      <div className="text-xs text-muted-foreground">{sousTitre}</div>
    </Link>
  );
}

function LienRapide({ href, icone, titre, desc }: { href: string; icone: string; titre: string; desc: string }) {
  return (
    <Link href={href} className="flex items-center gap-3 rounded-xl border p-3 transition hover:border-primary hover:bg-accent">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icone nom={icone} /></span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{titre}</span>
        <span className="block truncate text-xs text-muted-foreground">{desc}</span>
      </span>
    </Link>
  );
}

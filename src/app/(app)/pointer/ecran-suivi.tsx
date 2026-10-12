import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { POINTAGE_VALABLE, SCAN_VALABLE } from "@/lib/pointage-annulation";
import { resumeSemaineCourante } from "@/lib/pointage-suivi";
import { jourKinshasaISO } from "@/lib/date-paiement";
import { SuiviBulk } from "./suivi/suivi-bulk";
import { lignesSuivi } from "./suivi/lignes-suivi";
import { joursEnConge, joursDeReposSelonModele } from "@/lib/conges-couverture";

/**
 * Le SUIVI des pointages d'un jour — le contenu de « Pointages » pour la Direction et la RH. L'APPELANT a déjà
 * exigé la garde de page ET le rôle (ADMIN ou MANAGER) : cet écran lit tous les pointages.
 */
export async function EcranSuivi({ date: dateDemandee }: { date?: string }) {
  const jour = /^\d{4}-\d{2}-\d{2}$/.test(dateDemandee ?? "") ? dateDemandee! : jourKinshasaISO();
  const date = new Date(`${jour}T00:00:00Z`);
  const dateLabel = new Date(`${jour}T12:00:00Z`).toLocaleDateString("fr-FR", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });

  const [employees, pointages, semaine] = await Promise.all([
    prisma.employee.findMany({
      where: { actif: true },
      orderBy: [{ categorie: "asc" }, { nom: "asc" }],
      select: { id: true, nom: true, photoUrl: true, categorie: true },
    }),
    // Un pointage dont l'arrivée a été annulée par le salarié n'existe pas ici ; un scan annulé ne
    // compte pas (rien n'est effacé en base : cf. lib/pointage-annulation).
    prisma.pointage.findMany({
      where: { AND: [{ date }, POINTAGE_VALABLE] },
      select: {
        id: true, employeeId: true, heureDebut: true, heureFin: true, pauseMinutes: true, pauseParDefaut: true, source: true,
        scans: {
          where: SCAN_VALABLE,
          orderBy: { instant: "asc" },
          select: { id: true, moment: true, verdict: true, motif: true, distanceM: true, precisionM: true, verifieLe: true },
        },
      },
    }),
    // « Cette semaine » = la semaine EN COURS (maintenant), pas celle du jour affiché : c'est une
    // mesure glissante (§3 de la conception), indépendante du sélecteur de date ci-dessous.
    resumeSemaineCourante(prisma),
  ]);
  // Jour passé : une arrivée sans départ est un « départ manquant ». Congé (approuvé, ou C/S posé
  // sur la grille) et repos (planning > modèle, ou code O) : pas « Pas pointé ».
  const jourPasse = jour < jourKinshasaISO();
  const sansPointage = employees.filter((e) => !pointages.some((p) => p.employeeId === e.id)).map((e) => ({ employeeId: e.id, date: jour }));
  const [enConge, reposModele, codesDuJour] = await Promise.all([
    joursEnConge(sansPointage),
    joursDeReposSelonModele(sansPointage),
    prisma.attendance.findMany({ where: { date, code: { in: ["C", "S", "O"] } }, select: { employeeId: true, code: true } }),
  ]);
  const conges = new Set([...enConge].map((k) => k.split("|")[0]));
  const repos = new Set([...reposModele].map((k) => k.split("|")[0]));
  for (const a of codesDuJour) (a.code === "O" ? repos : conges).add(a.employeeId);
  const { lignes, nbTermine, nbEnCours, nbDepartManquant, nbAbsent, nbCongeRepos, totalHeures } = lignesSuivi(employees, pointages, { jourPasse, conges, repos });

  const autreJour = (delta: number) => {
    const d = new Date(`${jour}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + delta);
    return `/pointer?date=${d.toISOString().slice(0, 10)}`;
  };

  return (
    <div className="w-full">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">Pointages</h1>
          <p className="text-sm capitalize text-muted-foreground">{dateLabel}</p>
        </div>
        <Link href="/pointer?moi=1" className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">Pointer moi-même</Link>
      </div>

      <div className="mb-4 rounded-lg border bg-card px-3 py-2 text-sm">
        {semaine.total === 0 ? (
          <span className="text-muted-foreground">Cette semaine : aucun pointage par QR pour l&apos;instant.</span>
        ) : (
          <>
            Cette semaine : <span className="font-semibold tabular-nums">{semaine.horsRestaurant}</span>{" "}
            pointage{semaine.horsRestaurant > 1 ? "s" : ""} sur{" "}
            <span className="font-semibold tabular-nums">{semaine.total}</span> sans présence confirmée au
            restaurant ({semaine.pourcent} %)
          </>
        )}
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Link href={autreJour(-1)} className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">← Veille</Link>
        <Link href="/pointer" className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">Aujourd&apos;hui</Link>
        <Link href={autreJour(1)} className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">Lendemain →</Link>
        <form method="GET" className="flex items-center gap-2">
          <input type="date" name="date" defaultValue={jour} className="rounded-md border border-input bg-background px-3 py-1.5 text-sm" />
          <button type="submit" className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">Voir</button>
        </form>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          { l: "Terminés", v: nbTermine, c: "text-emerald-600" },
          jourPasse
            ? { l: "Départs manquants", v: nbDepartManquant, c: "text-red-700" }
            : { l: "En cours", v: nbEnCours, c: "text-amber-600" },
          { l: "Pas pointés", v: nbAbsent, c: "text-muted-foreground" },
          { l: "Congé ou repos", v: nbCongeRepos, c: "text-sky-700" },
          { l: "Total heures", v: `${totalHeures.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} h`, c: "text-foreground" },
        ].map((k) => (
          <div key={k.l} className="rounded-xl border bg-card p-3">
            <p className="text-xs text-muted-foreground">{k.l}</p>
            <p className={`mt-0.5 text-xl font-bold tabular-nums ${k.c}`}>{k.v}</p>
          </div>
        ))}
      </div>

      <SuiviBulk lignes={lignes} />

      <p className="mt-3 text-xs text-muted-foreground">
        Les heures affichées sont celles payées (départ − arrivée − pause saisie par le salarié ; la pause par défaut de 30 min
        n&apos;est pas déduite) et sont déjà reportées dans les Présences et les Heures,
        sauf un jour de congé approuvé (le congé prime).{" "}
        <Link href="/presences" className="text-primary underline">
          Pour saisir ou corriger des heures : Présences &amp; heures →
        </Link>
      </p>
    </div>
  );
}

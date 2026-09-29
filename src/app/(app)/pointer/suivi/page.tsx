import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { POINTAGE_VALABLE, SCAN_VALABLE } from "@/lib/pointage-annulation";
import { resumeSemaineCourante } from "@/lib/pointage-suivi";
import { jourKinshasaISO } from "@/lib/date-paiement";
import { SuiviBulk } from "./suivi-bulk";
import { lignesSuivi } from "./lignes-suivi";
import { exigerPageRH } from "@/lib/garde-page";

export default async function SuiviPointagesPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const user = await exigerPageRH();
  requireRole(user, ["ADMIN", "MANAGER"]);
  const sp = await searchParams;

  const jour = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : jourKinshasaISO();
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
  const { lignes, nbTermine, nbEnCours, nbAbsent, totalHeures } = lignesSuivi(employees, pointages);

  const autreJour = (delta: number) => {
    const d = new Date(`${jour}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + delta);
    return `/pointer/suivi?date=${d.toISOString().slice(0, 10)}`;
  };

  return (
    <div className="max-w-4xl">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">Suivi des pointages</h1>
          <p className="text-sm capitalize text-muted-foreground">{dateLabel}</p>
        </div>
        <Link href="/pointer" className="text-sm text-primary underline">← Ma pointeuse</Link>
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
        <Link href="/pointer/suivi" className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">Aujourd&apos;hui</Link>
        <Link href={autreJour(1)} className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">Lendemain →</Link>
        <form method="GET" className="flex items-center gap-2">
          <input type="date" name="date" defaultValue={jour} className="rounded-md border border-input bg-background px-3 py-1.5 text-sm" />
          <button type="submit" className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">Voir</button>
        </form>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { l: "Terminés", v: nbTermine, c: "text-emerald-600" },
          { l: "En cours", v: nbEnCours, c: "text-amber-600" },
          { l: "Pas pointés", v: nbAbsent, c: "text-muted-foreground" },
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

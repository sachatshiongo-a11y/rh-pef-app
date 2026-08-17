import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { verifySession, requireRole } from "@/lib/auth";
import { Avatar } from "@/components/avatar";

const TZ = "Africa/Lagos"; // UTC+1 = heure de Kinshasa (sans changement d'heure)
const hhmm = (d: Date) => d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
const jourKinshasaISO = () => {
  const k = new Date(Date.now() + 3_600_000);
  return `${k.getUTCFullYear()}-${String(k.getUTCMonth() + 1).padStart(2, "0")}-${String(k.getUTCDate()).padStart(2, "0")}`;
};

export default async function SuiviPointagesPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const user = await verifySession();
  requireRole(user, ["ADMIN", "MANAGER"]);
  const sp = await searchParams;

  const jour = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : jourKinshasaISO();
  const date = new Date(`${jour}T00:00:00Z`);
  const dateLabel = new Date(`${jour}T12:00:00Z`).toLocaleDateString("fr-FR", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });

  const [employees, pointages] = await Promise.all([
    prisma.employee.findMany({
      where: { actif: true },
      orderBy: [{ categorie: "asc" }, { nom: "asc" }],
      select: { id: true, nom: true, photoUrl: true, categorie: true },
    }),
    prisma.pointage.findMany({
      where: { date },
      select: { employeeId: true, heureDebut: true, heureFin: true, pauseMinutes: true },
    }),
  ]);
  const parEmp = new Map(pointages.map((p) => [p.employeeId, p]));

  const lignes = employees.map((e) => {
    const p = parEmp.get(e.id);
    const heures = p?.heureFin
      ? Math.max(0, (p.heureFin.getTime() - p.heureDebut.getTime()) / 3_600_000 - p.pauseMinutes / 60)
      : null;
    const statut = !p ? "ABSENT" : p.heureFin ? "TERMINE" : "EN_COURS";
    return { ...e, p, heures, statut };
  });
  const nbTermine = lignes.filter((l) => l.statut === "TERMINE").length;
  const nbEnCours = lignes.filter((l) => l.statut === "EN_COURS").length;
  const nbAbsent = lignes.filter((l) => l.statut === "ABSENT").length;
  const totalHeures = lignes.reduce((s, l) => s + (l.heures ?? 0), 0);

  const autreJour = (delta: number) => {
    const d = new Date(`${jour}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + delta);
    return `/pointer/suivi?date=${d.toISOString().slice(0, 10)}`;
  };

  const BADGE: Record<string, string> = {
    TERMINE: "bg-emerald-100 text-emerald-800",
    EN_COURS: "bg-amber-100 text-amber-800",
    ABSENT: "bg-muted text-muted-foreground",
  };
  const LABEL: Record<string, string> = { TERMINE: "Terminé", EN_COURS: "En cours", ABSENT: "Pas pointé" };

  return (
    <div className="max-w-4xl">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">Suivi des pointages</h1>
          <p className="text-sm capitalize text-muted-foreground">{dateLabel}</p>
        </div>
        <Link href="/pointer" className="text-sm text-primary underline">← Ma pointeuse</Link>
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

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[40rem] text-sm">
          <thead className="bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-medium">
              <th>Employé</th><th>Arrivée</th><th>Départ</th><th className="text-right">Pause</th><th className="text-right">Heures</th><th>Statut</th>
            </tr>
          </thead>
          <tbody>
            {lignes.map((l) => (
              <tr key={l.id} className="border-t">
                <td className="px-3 py-2">
                  <Link href={`/employes/${l.id}`} className="flex items-center gap-2 font-medium hover:underline">
                    <Avatar nom={l.nom} taille={26} photoUrl={l.photoUrl} />
                    <span className="truncate">{l.nom}</span>
                  </Link>
                </td>
                <td className="px-3 py-2 tabular-nums">{l.p ? hhmm(l.p.heureDebut) : "—"}</td>
                <td className="px-3 py-2 tabular-nums">{l.p?.heureFin ? hhmm(l.p.heureFin) : "—"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{l.p ? `${l.p.pauseMinutes} min` : "—"}</td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">{l.heures !== null ? `${l.heures.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} h` : "—"}</td>
                <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${BADGE[l.statut]}`}>{LABEL[l.statut]}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-muted-foreground">
        Lecture seule. Les heures affichées sont nettes (départ − arrivée − pause) et sont déjà reportées dans les Présences et les Heures.
      </p>
    </div>
  );
}

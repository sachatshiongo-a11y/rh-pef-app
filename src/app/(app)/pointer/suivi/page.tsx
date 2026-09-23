import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { verifySession, requireRole } from "@/lib/auth";
import { verdictDe } from "@/lib/pointage-scan";
import { libelleMotif, scanAVerifier } from "@/lib/pointage-qr";
import { resumeSemaineCourante } from "@/lib/pointage-suivi";
import { SuiviBulk, type LigneSuivi } from "./suivi-bulk";
import type { SourcePointage } from "@prisma/client";

const TZ = "Africa/Lagos"; // UTC+1 = heure de Kinshasa (sans changement d'heure)
const hhmm = (d: Date) => d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
const jourKinshasaISO = () => {
  const k = new Date(Date.now() + 3_600_000);
  return `${k.getUTCFullYear()}-${String(k.getUTCMonth() + 1).padStart(2, "0")}-${String(k.getUTCDate()).padStart(2, "0")}`;
};

// « QR », « manuel », « appli (ancien) » (brief) — IVMS n'arrive jamais sur ce modèle en pratique
// (réservé à l'import de présences), mais un libellé neutre évite un badge vide si ça change.
const LABEL_SOURCE: Record<SourcePointage, string> = {
  QR: "QR",
  MANUEL: "manuel",
  APP: "appli (ancien)",
  IVMS_RAPPORT: "IVMS",
  IVMS_API: "IVMS",
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

  const [employees, pointages, semaine] = await Promise.all([
    prisma.employee.findMany({
      where: { actif: true },
      orderBy: [{ categorie: "asc" }, { nom: "asc" }],
      select: { id: true, nom: true, photoUrl: true, categorie: true },
    }),
    prisma.pointage.findMany({
      where: { date },
      select: {
        id: true, employeeId: true, heureDebut: true, heureFin: true, pauseMinutes: true, source: true,
        scans: {
          orderBy: { instant: "asc" },
          select: { id: true, moment: true, verdict: true, motif: true, distanceM: true, precisionM: true, verifieLe: true },
        },
      },
    }),
    // « Cette semaine » = la semaine EN COURS (maintenant), pas celle du jour affiché : c'est une
    // mesure glissante (§3 de la conception), indépendante du sélecteur de date ci-dessous.
    resumeSemaineCourante(prisma),
  ]);
  const parEmp = new Map(pointages.map((p) => [p.employeeId, p]));

  const lignesBrutes = employees.map((e) => {
    const p = parEmp.get(e.id);
    const heures = p?.heureFin
      ? Math.max(0, (p.heureFin.getTime() - p.heureDebut.getTime()) / 3_600_000 - p.pauseMinutes / 60)
      : null;
    const statut: LigneSuivi["statut"] = !p ? "ABSENT" : p.heureFin ? "TERMINE" : "EN_COURS";

    const scans = p?.scans ?? [];
    // « À vérifier » se DÉRIVE des scans (un scan A_VERIFIER sans `verifieLe`) — jamais un booléen
    // recopié sur Pointage, même règle que la signature électronique. `scanAVerifier` est la
    // fonction pure testée dans `pointage-qr.test.ts` ; on ne la réécrit pas ici.
    const badgeArriveeScan = scanAVerifier(scans, "ARRIVEE");
    const badgeDepartScan = scanAVerifier(scans, "DEPART");
    const departScanneSansPause = !p?.heureFin && scans.some((s) => s.moment === "DEPART");

    const ligne: LigneSuivi = {
      employeeId: e.id,
      nom: e.nom,
      photoUrl: e.photoUrl,
      pointageId: p?.id ?? null,
      arriveeLabel: p ? hhmm(p.heureDebut) : "—",
      departLabel: p?.heureFin ? hhmm(p.heureFin) : departScanneSansPause ? "départ scanné, pause non saisie" : "—",
      pauseLabel: p ? `${p.pauseMinutes} min` : "—",
      heuresLabel: heures !== null ? `${heures.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} h` : "—",
      statut,
      sourceLabel: p ? LABEL_SOURCE[p.source] : null,
      badgeArrivee: badgeArriveeScan ? `À vérifier · ${libelleMotif(verdictDe(badgeArriveeScan))}` : null,
      badgeDepart: badgeDepartScan ? `À vérifier · ${libelleMotif(verdictDe(badgeDepartScan))}` : null,
      aVerifier: !!badgeArriveeScan || !!badgeDepartScan,
    };
    return { ligne, statut, heures };
  });
  const lignes: LigneSuivi[] = lignesBrutes.map((l) => l.ligne);

  const nbTermine = lignesBrutes.filter((l) => l.statut === "TERMINE").length;
  const nbEnCours = lignesBrutes.filter((l) => l.statut === "EN_COURS").length;
  const nbAbsent = lignesBrutes.filter((l) => l.statut === "ABSENT").length;
  const totalHeures = lignesBrutes.reduce((s, l) => s + (l.heures ?? 0), 0);

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
            Cette semaine : <span className="font-semibold tabular-nums">{semaine.aVerifier}</span>{" "}
            pointage{semaine.aVerifier > 1 ? "s" : ""} à vérifier sur{" "}
            <span className="font-semibold tabular-nums">{semaine.total}</span> ({semaine.pourcent} %)
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
        Les heures affichées sont nettes (départ − arrivée − pause) et sont déjà reportées dans les Présences et les Heures.
        La saisie manuelle des horaires se fait toujours depuis la fiche de l&apos;employé.
      </p>
    </div>
  );
}

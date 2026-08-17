import Link from "next/link";
import { COULEUR_CODE } from "../../presences/attendance-colors";
import type { CodePresence } from "@/lib/payroll";

/**
 * Onglet « Temps de travail » de la fiche employé (présentation façon Factorial) :
 *  — Planning : la semaine en cours + la suivante, Lun→Dim, une pastille par jour
 *    (nom du shift + durée, ou Repos) ;
 *  — Heures travaillées : les 8 dernières semaines, Lun→Dim, heures réellement saisies
 *    (Présences & heures) avec le code du jour (C, M, F…) quand il n'y a pas d'heures,
 *    et le total de chaque semaine.
 */

const JOURS_COURTS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

function fmtH(h: number) {
  const heures = Math.floor(h);
  const minutes = Math.round((h - heures) * 60);
  return `${heures}h ${minutes}m`;
}

function addJours(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function labelJour(iso: string) {
  return new Date(`${iso}T00:00:00.000Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });
}

export function TempsTravail({
  lundiCourantIso,
  creneaux,
  heures,
  codes,
}: {
  lundiCourantIso: string;
  creneaux: { iso: string; nom: string; heures: number }[];
  heures: { iso: string; h: number }[];
  codes: { iso: string; code: string }[];
}) {
  const creneauParJour = new Map(creneaux.map((c) => [c.iso, c]));
  const heuresParJour = new Map(heures.map((h) => [h.iso, h.h]));
  const codeParJour = new Map(codes.map((c) => [c.iso, c.code]));
  const isoAujourdHui = new Date().toISOString().slice(0, 10);

  // Planning : semaine en cours + suivante.
  const semainesPlanning = [0, 1].map((s) => {
    const lundi = addJours(lundiCourantIso, s * 7);
    return {
      lundi,
      label: s === 0 ? "Cette semaine" : "Semaine prochaine",
      sousLabel: `du ${labelJour(lundi)} au ${labelJour(addJours(lundi, 6))}`,
      jours: Array.from({ length: 7 }, (_, i) => {
        const iso = addJours(lundi, i);
        return { iso, creneau: creneauParJour.get(iso) ?? null };
      }),
    };
  });

  // Rapport d'heures : les 8 dernières semaines (la plus ancienne en haut, la courante en bas).
  const semainesHeures = Array.from({ length: 8 }, (_, idx) => {
    const s = idx - 7;
    const lundi = addJours(lundiCourantIso, s * 7);
    const jours = Array.from({ length: 7 }, (_, i) => {
      const iso = addJours(lundi, i);
      return { iso, h: heuresParJour.get(iso) ?? null, code: codeParJour.get(iso) ?? null };
    });
    const total = jours.reduce((a, j) => a + (j.h ?? 0), 0);
    return { lundi, label: `${labelJour(lundi)} – ${labelJour(addJours(lundi, 6))}`, jours, total, courante: s === 0 };
  });
  const totalPeriode = semainesHeures.reduce((a, s) => a + s.total, 0);

  return (
    <>
      {/* Planning individuel */}
      <div className="mb-5 rounded-2xl border bg-card p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Planning</h2>
          <Link href="/planning" className="text-sm font-medium text-primary underline">Voir le planning complet →</Link>
        </div>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[44rem] text-sm">
            <thead className="bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-medium">
                <th>Période</th>
                {JOURS_COURTS.map((j) => <th key={j} className="text-center">{j}</th>)}
              </tr>
            </thead>
            <tbody>
              {semainesPlanning.map((sem) => (
                <tr key={sem.lundi} className="border-t">
                  <td className="px-3 py-2">
                    <p className="font-medium">{sem.label}</p>
                    <p className="text-xs text-muted-foreground">{sem.sousLabel}</p>
                  </td>
                  {sem.jours.map((j) => (
                    <td key={j.iso} className={`px-1.5 py-2 text-center ${j.iso === isoAujourdHui ? "bg-primary/5" : ""}`}>
                      {j.creneau ? (
                        j.creneau.heures > 0 ? (
                          <span className="inline-flex flex-col rounded-md bg-teal-50 px-2 py-1 text-xs font-medium text-teal-800">
                            <span>{j.creneau.nom}</span>
                            <span className="font-semibold tabular-nums">{fmtH(j.creneau.heures)}</span>
                          </span>
                        ) : (
                          <span className="inline-flex rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">{j.creneau.nom}</span>
                        )
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          « — » = rien de planifié ce jour-là. Le planning se remplit dans l&apos;onglet Planning (à la main ou via la génération automatique).
        </p>
      </div>

      {/* Rapport d'heures travaillées */}
      <div className="mb-5 rounded-2xl border bg-card p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Heures travaillées — 8 dernières semaines</h2>
          <Link href="/presences" className="text-sm font-medium text-primary underline">Voir présences &amp; heures →</Link>
        </div>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[44rem] text-sm">
            <thead className="bg-muted text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-medium">
                <th>Période</th>
                {JOURS_COURTS.map((j) => <th key={j} className="text-center">{j}</th>)}
                <th className="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {semainesHeures.map((sem) => (
                <tr key={sem.lundi} className={`border-t ${sem.courante ? "bg-primary/5 font-medium" : ""}`}>
                  <td className="whitespace-nowrap px-3 py-1.5">{sem.label}{sem.courante ? " ·" : ""}</td>
                  {sem.jours.map((j) => (
                    <td key={j.iso} className="px-1.5 py-1.5 text-center">
                      {j.h !== null && j.h > 0 ? (
                        <span className="inline-flex rounded-md bg-teal-50 px-1.5 py-0.5 text-xs font-medium tabular-nums text-teal-800">{fmtH(j.h)}</span>
                      ) : j.code ? (
                        <span className={`inline-flex rounded-md px-1.5 py-0.5 text-xs font-semibold ${COULEUR_CODE[j.code as CodePresence] ?? "bg-muted text-muted-foreground"}`}>{j.code}</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                  ))}
                  <td className="px-3 py-1.5 text-right tabular-nums">{sem.total > 0 ? fmtH(sem.total) : "—"}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t bg-muted/40 font-medium">
                <td className="px-3 py-1.5" colSpan={8}>Total sur 8 semaines</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{totalPeriode > 0 ? fmtH(totalPeriode) : "—"}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Heures issues de Présences &amp; heures (saisies, pointages, imports). Quand un jour n&apos;a pas d&apos;heures,
          son code de présence est affiché (C = congé, M = maladie, F = férié…).
        </p>
      </div>
    </>
  );
}

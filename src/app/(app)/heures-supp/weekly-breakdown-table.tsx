import { Fragment } from "react";
import Link from "next/link";
import type { DetailSemaineHS } from "@/lib/payroll";
import type { EmployeeRow } from "./hours-grid";

export function WeeklyBreakdownTable({
  employees,
  semainesParEmploye,
  nbSemaines,
}: {
  employees: EmployeeRow[];
  semainesParEmploye: Record<string, DetailSemaineHS[]>;
  nbSemaines: number;
}) {
  const semaines = Array.from({ length: nbSemaines }, (_, i) => i + 1);

  return (
    <>
    {/* Mobile : une carte par employé, une ligne par semaine. */}
    <div className="space-y-2 lg:hidden">
      {employees.map((e) => {
        const parNumero = new Map((semainesParEmploye[e.id] ?? []).map((s) => [s.semaine, s]));
        return (
          <div key={e.id} className="rounded-xl border bg-card p-3">
            <Link href={`/employes/${e.id}`} className="font-medium text-primary hover:underline">{e.nom}</Link>
            <div className="mt-2 space-y-1">
              {semaines.map((s) => {
                const d = parNumero.get(s);
                return (
                  <div key={s} className="flex items-center justify-between gap-3 text-xs">
                    <span className="text-muted-foreground">Semaine {s}</span>
                    <span className="tabular-nums">
                      {d ? `${d.heuresTotales} h` : "—"}
                      {d && (d.hs30 || d.hs60 || d.hs100) ? (
                        <span className="ml-2 text-muted-foreground">HS 30/60/100 : {d.hs30 || 0}·{d.hs60 || 0}·{d.hs100 || 0}</span>
                      ) : null}
                    </span>
                  </div>
                );
              })}
              {(semainesParEmploye[e.id] ?? []).length === 0 && <p className="text-xs text-muted-foreground">Aucune heure.</p>}
            </div>
          </div>
        );
      })}
      {employees.length === 0 && <p className="rounded-xl border p-6 text-center text-sm text-muted-foreground">Aucun employé.</p>}
    </div>

    {/* Ordinateur : tableau. */}
    <div className="hidden overflow-x-auto rounded-lg border lg:block">
      <table className="text-sm">
        <thead className="bg-muted/50 text-left">
          <tr>
            <th rowSpan={2} className="sticky left-0 z-10 bg-muted/50 px-3 py-2 align-bottom">
              Employé
            </th>
            {semaines.map((s) => (
              <th key={s} colSpan={4} className="border-l px-2 py-1 text-center">
                Semaine {s}
              </th>
            ))}
          </tr>
          <tr>
            {semaines.map((s) => (
              <Fragment key={s}>
                <th className="border-l px-2 py-1 text-center font-normal">Total</th>
                <th className="px-2 py-1 text-center font-normal">30%</th>
                <th className="px-2 py-1 text-center font-normal">60%</th>
                <th className="px-2 py-1 text-center font-normal">100%</th>
              </Fragment>
            ))}
          </tr>
        </thead>
        <tbody>
          {employees.map((e) => {
            const semainesEmploye = semainesParEmploye[e.id] ?? [];
            const parNumero = new Map(semainesEmploye.map((s) => [s.semaine, s]));
            return (
              <tr key={e.id} className="border-t">
                <td className="sticky left-0 z-10 whitespace-nowrap bg-background px-3 py-1.5">
                  <Link href={`/employes/${e.id}`} className="hover:text-primary hover:underline">
                    {e.nom}
                  </Link>
                </td>
                {semaines.map((s) => {
                  const detail = parNumero.get(s);
                  return (
                    <Fragment key={s}>
                      <td className="border-l px-2 py-1.5 text-center">
                        {detail ? detail.heuresTotales : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-center">{detail?.hs30 || ""}</td>
                      <td className="px-2 py-1.5 text-center">{detail?.hs60 || ""}</td>
                      <td className="px-2 py-1.5 text-center">{detail?.hs100 || ""}</td>
                    </Fragment>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    </>
  );
}

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
    <div className="overflow-x-auto rounded-lg border">
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
  );
}

"use client";

import { useActionState } from "react";
import { importerPointageIVMS, type ResultatImport } from "./import-actions";

export function ImportPointage() {
  const [state, action, pending] = useActionState<ResultatImport | null, FormData>(
    importerPointageIVMS,
    null
  );

  return (
    <details className="mb-6 rounded-lg border">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
        Importer un rapport de pointage (IVMS-4200)
      </summary>
      <div className="border-t p-4">
        <p className="mb-3 text-xs text-muted-foreground">
          Chargez le rapport de présence exporté par IVMS-4200 (Excel ou CSV). Les heures sont
          calculées par première entrée / dernière sortie. Un jour couvert par un congé validé
          n&apos;est pas écrasé, et les anomalies (pointage manquant, durée aberrante, ID inconnu)
          sont signalées sans être appliquées.
        </p>
        <form action={action} className="flex flex-wrap items-center gap-3">
          <input
            type="file"
            name="fichier"
            accept=".xlsx,.xls,.csv"
            required
            className="text-sm"
          />
          <button
            type="submit"
            disabled={pending}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
          >
            {pending ? "Import en cours..." : "Importer"}
          </button>
        </form>

        {state && (
          <div
            className={`mt-3 rounded-md p-3 text-sm ${
              state.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"
            }`}
          >
            <p className="font-medium">{state.message}</p>
            {state.anomalies && state.anomalies.length > 0 && (
              <div className="mt-2">
                <p className="text-xs font-semibold">Anomalies (non appliquées) :</p>
                <ul className="mt-1 max-h-40 list-inside list-disc space-y-0.5 overflow-auto text-xs">
                  {state.anomalies.map((a, i) => (
                    <li key={i}>
                      {a.date} · {a.idExterne} · {a.type} — {a.detail}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </details>
  );
}

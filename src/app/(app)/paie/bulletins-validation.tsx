"use client";

import { useState } from "react";
import { StatusActions } from "./status-actions";
import { Avatar } from "@/components/avatar";
import { TelechargerLien } from "@/components/telecharger-lien";
import { LIBELLE_STATUT, COULEUR_STATUT } from "@/lib/paie-etats";
import type { PaieRow } from "./paie-bulk";
import type { Devise } from "@/lib/pdf/theme";

function money(n: number) {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " $";
}

/**
 * Vérification / validation des bulletins façon PayFit : liste des salariés à gauche, vrai
 * bulletin PDF rendu en iframe à droite (sans téléchargement), avec agrandissement plein écran.
 */
export function BulletinsValidation({ rows, peutValider }: { rows: PaieRow[]; peutValider: boolean }) {
  const [selId, setSelId] = useState<string | null>(null);
  const [devise, setDevise] = useState<Devise>("USD");
  const [recherche, setRecherche] = useState("");
  const [agrandi, setAgrandi] = useState(false);

  const filtres = rows.filter((r) => r.nom.toLowerCase().includes(recherche.trim().toLowerCase()));
  const sel = rows.find((r) => r.id === selId) ?? null;
  const src = sel ? `/paie/bulletin/${sel.id}?devise=${devise}` : "";

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-8 text-center text-sm text-muted-foreground">
        Aucun bulletin calculé pour ce mois.
      </div>
    );
  }

  return (
    <div className="mb-6 grid gap-4 lg:grid-cols-[300px_1fr]">
      {/* Liste des salariés */}
      <div className="overflow-hidden rounded-xl border bg-card">
        <div className="border-b p-2">
          <input
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder="Rechercher un salarié…"
            className="w-full rounded-md border px-2.5 py-1.5 text-sm"
          />
        </div>
        <ul className="max-h-[560px] divide-y overflow-y-auto">
          {filtres.map((r) => (
            <li key={r.id}>
              <button
                onClick={() => setSelId(r.id)}
                className={`flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left hover:bg-accent/50 ${
                  r.id === selId ? "bg-primary/10" : ""
                }`}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <Avatar nom={r.nom} taille={28} photoUrl={r.photoUrl} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{r.nom}</p>
                    <p className="text-xs text-muted-foreground">{money(r.salNetUSD)}</p>
                  </div>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${COULEUR_STATUT[r.statutPaiement]}`}>
                  {LIBELLE_STATUT[r.statutPaiement]}
                </span>
              </button>
            </li>
          ))}
          {filtres.length === 0 && (
            <li className="px-3 py-4 text-center text-xs text-muted-foreground">Aucun résultat.</li>
          )}
        </ul>
      </div>

      {/* Aperçu du bulletin */}
      <div className="overflow-hidden rounded-xl border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{sel?.nom ?? "—"}</span>
            {sel && (
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${COULEUR_STATUT[sel.statutPaiement]}`}>
                {LIBELLE_STATUT[sel.statutPaiement]}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex overflow-hidden rounded-md border text-xs">
              {(["USD", "CDF"] as Devise[]).map((d) => (
                <button
                  key={d}
                  onClick={() => setDevise(d)}
                  className={`px-2.5 py-1 ${devise === d ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
                >
                  {d === "USD" ? "$" : "CDF"}
                </button>
              ))}
            </div>
            <button onClick={() => setAgrandi(true)} className="rounded-md border px-2.5 py-1 text-xs hover:bg-accent" disabled={!sel}>
              Agrandir
            </button>
            {sel && (
              <TelechargerLien href={`${src}&dl=1`} className="rounded-md border px-2.5 py-1 text-xs hover:bg-accent">
                Télécharger
              </TelechargerLien>
            )}
            {sel && peutValider && (
              <StatusActions payrollLineId={sel.id} statut={sel.statutPaiement} peutValider={peutValider} modePaiementDefaut={sel.modePaiementDefaut} />
            )}
          </div>
        </div>
        {sel ? (
          <iframe key={src} src={src} title={`Bulletin ${sel.nom}`} className="h-[560px] w-full bg-muted" />
        ) : (
          <div className="flex h-[560px] items-center justify-center text-sm text-muted-foreground">
            Sélectionnez un salarié.
          </div>
        )}
      </div>

      {/* Plein écran */}
      {agrandi && sel && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/70 p-4" onClick={() => setAgrandi(false)}>
          <div className="mx-auto flex h-full w-full max-w-5xl flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between rounded-t-lg bg-card px-4 py-2">
              <span className="text-sm font-semibold">Bulletin — {sel.nom}</span>
              <div className="flex items-center gap-2">
                <div className="flex overflow-hidden rounded-md border text-xs">
                  {(["USD", "CDF"] as Devise[]).map((d) => (
                    <button
                      key={d}
                      onClick={() => setDevise(d)}
                      className={`px-2.5 py-1 ${devise === d ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
                    >
                      {d === "USD" ? "$" : "CDF"}
                    </button>
                  ))}
                </div>
                <TelechargerLien href={`${src}&dl=1`} className="rounded-md border px-2.5 py-1 text-xs hover:bg-accent">
                  Télécharger
                </TelechargerLien>
                <button onClick={() => setAgrandi(false)} className="rounded-md border px-2.5 py-1 text-xs hover:bg-accent">
                  Réduire ✕
                </button>
              </div>
            </div>
            <iframe key={`big-${src}`} src={src} title={`Bulletin ${sel.nom} agrandi`} className="w-full flex-1 rounded-b-lg bg-white" />
          </div>
        </div>
      )}
    </div>
  );
}

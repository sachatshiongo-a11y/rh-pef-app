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

/** Ligne compacte de l'aperçu léger (carte mobile). `usd` négatif = retenue. */
function MiniLigne({ label, usd, fort }: { label: string; usd: number; fort?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${fort ? "font-medium" : "text-muted-foreground"}`}>
      <span>{label}</span>
      <span className={usd < 0 ? "text-red-600" : ""}>
        {usd < 0 ? "− " : ""}
        {money(Math.abs(usd))}
      </span>
    </div>
  );
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
    <>
      {/* ————— MOBILE : une carte par salarié (net, statut, télécharger, valider). Pas d'aperçu
          PDF ni de tableau large : lecture et validation simples au doigt. ————— */}
      <div className="mb-6 lg:hidden">
        <input
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
          placeholder="Rechercher un salarié…"
          className="mb-3 w-full rounded-md border px-3 py-2 text-sm"
        />
        <div className="space-y-2">
          {filtres.map((r) => (
            <div key={r.id} className="rounded-xl border bg-card p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <Avatar nom={r.nom} taille={32} photoUrl={r.photoUrl} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{r.nom}</p>
                    <p className="text-xs text-muted-foreground">Net : {money(r.salNetUSD)}</p>
                  </div>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${COULEUR_STATUT[r.statutPaiement]}`}>
                  {LIBELLE_STATUT[r.statutPaiement]}
                </span>
              </div>
              {/* Aperçu léger dépliable (HTML instantané, pas de PDF) */}
              <details className="group mt-2 border-t pt-2">
                <summary className="flex cursor-pointer list-none items-center gap-1 text-xs font-medium text-primary [&::-webkit-details-marker]:hidden">
                  <span aria-hidden className="transition-transform group-open:rotate-90">▸</span>
                  Aperçu du bulletin
                </summary>
                <div className="mt-2 space-y-0.5 text-xs">
                  <MiniLigne label="Salaire de base" usd={r.baseUSD} />
                  {r.hsUSD > 0 && <MiniLigne label="Heures supp." usd={r.hsUSD} />}
                  {r.transportUSD > 0 && <MiniLigne label="Transport" usd={r.transportUSD} />}
                  {r.primesUSD > 0 && <MiniLigne label="Primes" usd={r.primesUSD} />}
                  <MiniLigne label="Salaire brut" usd={r.salBrutUSD} fort />
                  <MiniLigne label="CNSS" usd={-r.cnssUSD} />
                  <MiniLigne label="IPR" usd={-r.iprUSD} />
                  {r.acompteUSD > 0 && <MiniLigne label="Acompte" usd={-r.acompteUSD} />}
                  {r.allocUSD > 0 && <MiniLigne label="Allocation familiale" usd={r.allocUSD} />}
                  {r.fraisMedUSD > 0 && <MiniLigne label="Frais médicaux" usd={r.fraisMedUSD} />}
                  <div className="mt-1 flex items-center justify-between border-t pt-1 text-sm font-semibold">
                    <span>Net à payer</span>
                    <span>
                      {money(r.salNetUSD)}
                      <span className="ml-1 text-xs font-normal text-muted-foreground">
                        {Math.round(r.salNetCDF).toLocaleString("fr-FR")} CDF
                      </span>
                    </span>
                  </div>
                </div>
              </details>

              <div className="mt-2 flex flex-wrap items-center gap-2 border-t pt-2">
                <TelechargerLien
                  href={`/paie/bulletin/${r.id}?devise=USD&dl=1`}
                  className="rounded-md border px-2.5 py-1 text-xs hover:bg-accent"
                >
                  Bulletin $
                </TelechargerLien>
                <TelechargerLien
                  href={`/paie/bulletin/${r.id}?devise=CDF&dl=1`}
                  className="rounded-md border px-2.5 py-1 text-xs hover:bg-accent"
                >
                  Bulletin CDF
                </TelechargerLien>
                {peutValider && (
                  <div className="ml-auto">
                    <StatusActions payrollLineId={r.id} statut={r.statutPaiement} peutValider={peutValider} modePaiementDefaut={r.modePaiementDefaut} />
                  </div>
                )}
              </div>
            </div>
          ))}
          {filtres.length === 0 && (
            <p className="rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground">
              Aucun résultat.
            </p>
          )}
        </div>
      </div>

      {/* ————— ORDINATEUR : liste des salariés + aperçu PDF collant ————— */}
      <div className="mb-6 hidden items-start gap-4 lg:grid lg:grid-cols-[300px_1fr]">
      {/* Liste des salariés — collante et à la même hauteur que l'aperçu */}
      <div className="overflow-hidden rounded-xl border bg-card lg:sticky lg:top-4 lg:flex lg:max-h-[82vh] lg:flex-col">
        <div className="border-b p-2">
          <input
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder="Rechercher un salarié…"
            className="w-full rounded-md border px-2.5 py-1.5 text-sm"
          />
        </div>
        <ul className="max-h-[560px] divide-y overflow-y-auto lg:max-h-none lg:flex-1">
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
      <div className="overflow-hidden rounded-xl border bg-card lg:sticky lg:top-4">
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
          <>
            {/* Aperçu inline : ordinateur seulement. Sur mobile l'iframe PDF prend trop de place
                et se lit mal → on propose le plein écran / le téléchargement à la place. */}
            <iframe
              key={src}
              src={src}
              title={`Bulletin ${sel.nom}`}
              className="hidden h-[560px] w-full bg-muted lg:block lg:h-[82vh]"
            />
            <div className="flex flex-col items-center gap-3 px-4 py-6 text-center lg:hidden">
              <p className="text-sm text-muted-foreground">
                Aperçu masqué sur mobile pour plus de lisibilité.
              </p>
              <button
                onClick={() => setAgrandi(true)}
                className="rounded-md border bg-card px-4 py-2 text-sm font-medium hover:bg-accent"
              >
                Voir le bulletin en plein écran
              </button>
            </div>
          </>
        ) : (
          <div className="flex min-h-[120px] items-center justify-center p-6 text-sm text-muted-foreground lg:h-[82vh]">
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
    </>
  );
}

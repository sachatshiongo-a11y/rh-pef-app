"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { StatusActions } from "./status-actions";
import { Avatar } from "@/components/avatar";
import { TelechargerLien } from "@/components/telecharger-lien";
import { useLockBodyScroll } from "@/components/use-lock-body-scroll";
import { LIBELLE_STATUT, COULEUR_STATUT } from "@/lib/paie-etats";
import { LBL_BULLETIN as L } from "@/lib/bulletin-format";
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
  useLockBodyScroll(agrandi);

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
                  <MiniLigne label={L.base} usd={r.baseUSD} />
                  {r.hsUSD > 0 && <MiniLigne label={L.hs} usd={r.hsUSD} />}
                  {r.transportUSD > 0 && <MiniLigne label={L.transport} usd={r.transportUSD} />}
                  {r.primesUSD > 0 && <MiniLigne label="Primes" usd={r.primesUSD} />}
                  <MiniLigne label={L.brut} usd={r.salBrutUSD} fort />
                  <MiniLigne label={L.cnss} usd={-r.cnssUSD} />
                  <MiniLigne label={L.ipr} usd={-r.iprUSD} />
                  {r.acompteUSD > 0 && <MiniLigne label={L.acompte} usd={-r.acompteUSD} />}
                  {r.allocUSD > 0 && <MiniLigne label={L.alloc} usd={r.allocUSD} />}
                  {r.fraisMedUSD > 0 && <MiniLigne label={L.fraisMedicaux} usd={r.fraisMedUSD} />}
                  <div className="mt-1 flex items-center justify-between border-t pt-1 text-sm font-semibold">
                    <span>{L.net}</span>
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

      {/* Plein écran — rendue via portail DANS <body>, hors de la coquille `overflow-hidden` de
          l'app (voir app-shell.tsx, même piège déjà rencontré pour le voile du tiroir mobile) :
          sur iOS Safari/PWA, un descendant `position: fixed` d'un ancêtre `overflow: hidden` peut
          être recadré aux bornes de cet ancêtre au lieu du viewport entier — d'où un aperçu réduit
          à « une petite case » et le doigt piégé entre deux zones scrollables (page figée). */}
      {agrandi &&
        sel &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex flex-col overscroll-contain bg-black/70 p-2 sm:p-4"
            onClick={() => setAgrandi(false)}
          >
            <div
              className="mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-t-lg bg-card px-4 py-2">
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">Bulletin — {sel.nom}</span>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
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
                  {/* Repli visible : sur iOS, l'aperçu PDF en iframe se comporte parfois mal
                      (rendu partiel, scroll capturé). Un onglet séparé utilise le vrai lecteur PDF
                      du système, toujours fiable. */}
                  <a
                    href={src}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-md border px-2.5 py-1 text-xs hover:bg-accent"
                  >
                    Nouvel onglet
                  </a>
                  <TelechargerLien href={`${src}&dl=1`} className="rounded-md border px-2.5 py-1 text-xs hover:bg-accent">
                    Télécharger
                  </TelechargerLien>
                  <button onClick={() => setAgrandi(false)} className="rounded-md border px-2.5 py-1 text-xs hover:bg-accent">
                    Réduire ✕
                  </button>
                </div>
              </div>
              <iframe
                key={`big-${src}`}
                src={src}
                title={`Bulletin ${sel.nom} agrandi`}
                className="h-full min-h-0 w-full flex-1 rounded-b-lg bg-white"
              />
            </div>
          </div>,
          document.body,
        )}
      </div>
    </>
  );
}

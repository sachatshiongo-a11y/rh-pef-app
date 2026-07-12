"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { mouvementManuel, supprimerMouvement, supprimerMouvementsEnLot } from "./actions";
import { BoutonReinitialiser } from "../_rapport/bouton-reinitialiser";
import { qte, usd } from "@/lib/stock";

type Art = { id: string; designation: string };
const inp = "rounded border border-input bg-background px-2 py-1 text-sm";

// Version sérialisable d'un mouvement (Decimal/Date convertis) — passée du serveur au client.
export type MvtLite = {
  id: string;
  articleId: string;
  designation: string;
  dateISO: string; // AAAA-MM-JJ
  origine: string | null;
  type: string;
  quantite: number;
  valeur: number | null;
  valeurEstimee: boolean;
  facture: { id: string; numero: string | null } | null;
  bc: { id: string; numero: string } | null;
  fournId: string | null;
  fournNom: string | null;
};

const chip = "rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/20";

/**
 * Colonne de mouvements (entrées ou sorties) groupés par jour, avec sélection multiple et
 * suppression groupée (Direction) — même logique « actions groupées » que le reste de l'app.
 */
export function ColonneMouvements({ titre, mouvements, signe, couleur, estDirection }: {
  titre: string; mouvements: MvtLite[]; signe: string; couleur: string; estDirection: boolean;
}) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [isPending, start] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);

  const jours = useMemo(() => {
    const acc: { cle: string; titre: string; lignes: MvtLite[] }[] = [];
    const idx = new Map<string, number>();
    for (const m of mouvements) {
      if (!idx.has(m.dateISO)) {
        idx.set(m.dateISO, acc.length);
        acc.push({ cle: m.dateISO, titre: new Date(`${m.dateISO}T00:00:00Z`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }), lignes: [] });
      }
      acc[idx.get(m.dateISO)!].lignes.push(m);
    }
    return acc;
  }, [mouvements]);

  const totalValeur = (ms: MvtLite[]) => ms.reduce((t, m) => t + (m.valeur ?? 0), 0);
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleJour = (lignes: MvtLite[], on: boolean) => setSel((s) => { const n = new Set(s); for (const m of lignes) { if (on) n.add(m.id); else n.delete(m.id); } return n; });

  const supprimerSel = () => {
    if (!confirm(`Supprimer ${sel.size} mouvement(s) ? Leur effet sur le stock sera annulé.`)) return;
    setErreur(null);
    start(async () => { try { await supprimerMouvementsEnLot([...sel]); setSel(new Set()); } catch (e) { setErreur(e instanceof Error ? e.message : "Erreur."); } });
  };

  return (
    <div className="overflow-hidden rounded-lg border">
      <div className={`flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2 text-sm font-semibold ${couleur}`}>
        <span>{titre} <span className="font-normal opacity-70">· {mouvements.length}</span></span>
        <span className="text-xs font-normal opacity-80">≈ {usd(totalValeur(mouvements))}</span>
      </div>

      {/* Barre d'actions groupées (Direction) */}
      {estDirection && sel.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b bg-muted/40 px-3 py-2 text-sm">
          <span className="font-medium">{sel.size} sélectionné(s)</span>
          <button disabled={isPending} onClick={supprimerSel} className="rounded-md border border-destructive/40 px-3 py-1 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50">Supprimer la sélection</button>
          <button onClick={() => setSel(new Set())} className="text-xs text-muted-foreground underline">Annuler</button>
        </div>
      )}
      {erreur && <p className="border-b bg-destructive/10 px-3 py-2 text-xs text-destructive">{erreur}</p>}

      <div className="max-h-[70vh] divide-y overflow-auto">
        {jours.map((j, ji) => {
          const tousSel = estDirection && j.lignes.every((m) => sel.has(m.id));
          return (
            <details key={j.cle} open={ji === 0} className="group">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 bg-muted/40 px-3 py-1.5 text-xs font-semibold capitalize [&::-webkit-details-marker]:hidden">
                <span className="flex items-center gap-1.5">
                  {estDirection && <input type="checkbox" checked={tousSel} onClick={(e) => e.stopPropagation()} onChange={(e) => toggleJour(j.lignes, e.target.checked)} aria-label="Tout sélectionner ce jour" />}
                  <span aria-hidden className="transition-transform group-open:rotate-90">▸</span>{j.titre}
                </span>
                <span className="font-normal text-muted-foreground">{j.lignes.length} mouvement(s) · {signe}{qte(j.lignes.reduce((t, m) => t + m.quantite, 0))} · ≈ {usd(totalValeur(j.lignes))}</span>
              </summary>
              <div className="divide-y border-t">
                {j.lignes.map((m) => (
                  <div key={m.id} className={`flex items-center justify-between gap-3 px-3 py-1.5 ${sel.has(m.id) ? "bg-primary/10" : ""}`}>
                    <div className="flex min-w-0 items-start gap-2">
                      {estDirection && <input type="checkbox" checked={sel.has(m.id)} onChange={() => toggle(m.id)} className="mt-1 shrink-0" aria-label="Sélectionner" />}
                      <div className="min-w-0">
                        <Link href={`/stock/catalogue/${m.articleId}`} className="truncate font-medium text-primary hover:underline">{m.designation}</Link>
                        {m.origine && <div className="truncate text-[11px] text-muted-foreground">{m.origine}</div>}
                        {(m.facture || m.bc || m.fournId) && (
                          <div className="mt-0.5 flex flex-wrap items-center gap-1">
                            {m.facture && <Link href={`/stock/factures/${m.facture.id}`} className={chip}>🧾 Facture{m.facture.numero ? ` ${m.facture.numero}` : ""}</Link>}
                            {m.bc && <Link href={`/stock/commandes/${m.bc.id}`} className={chip}>📄 BC {m.bc.numero}</Link>}
                            {m.fournId && <Link href={`/stock/fournisseurs/${m.fournId}`} className={chip}>🏢 {m.fournNom ?? "Fournisseur"}</Link>}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-3 text-right">
                      <div>
                        <div className="font-semibold tabular-nums">{signe}{qte(m.quantite)}</div>
                        <div className="text-[11px] tabular-nums text-muted-foreground">{m.valeur !== null ? `${m.valeurEstimee ? "≈ " : ""}${usd(m.valeur)}` : "—"}</div>
                      </div>
                      {estDirection && <SupprimerMouvementBtn id={m.id} />}
                    </div>
                  </div>
                ))}
              </div>
            </details>
          );
        })}
        {mouvements.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted-foreground">Aucun mouvement.</p>}
      </div>
    </div>
  );
}

export function SupprimerMouvementBtn({ id }: { id: string }) {
  const [isPending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={isPending}
      title="Supprimer ce mouvement (annule son effet sur le stock)"
      onClick={() => { if (confirm("Supprimer ce mouvement ? Son effet sur le stock sera annulé.")) start(() => supprimerMouvement(id)); }}
      className="rounded border px-1.5 py-0.5 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
    >
      ✕
    </button>
  );
}

export function MouvementForm({ articles, estDirection = false }: { articles: Art[]; estDirection?: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; texte: string } | null>(null);
  const [nb, setNb] = useState(3);
  const [type, setType] = useState<"ENTREE" | "SORTIE">("ENTREE");
  const [motif, setMotif] = useState<"PERTE" | "LIVRAISON_RESTAURANT" | "">("");
  const [ouvert, setOuvert] = useState(false);
  const [cle, setCle] = useState(0);
  const reinitialiser = () => { setNb(3); setType("ENTREE"); setMotif(""); setMsg(null); setCle((c) => c + 1); };

  const submit = (fd: FormData) => {
    setMsg(null);
    startTransition(async () => {
      try { await mouvementManuel(fd); setMsg({ ok: true, texte: type === "ENTREE" ? "Entrée enregistrée : stock incrémenté." : "Sortie enregistrée : stock décrémenté." }); setNb(3); }
      catch (e) { setMsg({ ok: false, texte: e instanceof Error ? e.message : "Erreur." }); }
    });
  };

  if (!ouvert) return <button onClick={() => setOuvert(true)} className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">± Mouvement manuel (entrée / sortie)</button>;

  return (
    <form key={cle} action={submit} className="space-y-2 rounded-lg border p-4">
      {msg && <p className={`rounded-md border px-3 py-2 text-sm ${msg.ok ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-destructive/40 bg-destructive/10 text-destructive"}`}>{msg.texte}</p>}

      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex overflow-hidden rounded-md border text-sm">
          <button type="button" onClick={() => setType("ENTREE")} className={`px-3 py-1.5 ${type === "ENTREE" ? "bg-success text-white" : "hover:bg-accent"}`}>Entrée</button>
          <button type="button" onClick={() => setType("SORTIE")} className={`px-3 py-1.5 ${type === "SORTIE" ? "bg-destructive text-white" : "hover:bg-accent"}`}>Sortie</button>
        </div>
        <input type="hidden" name="type" value={type} />
        {type === "ENTREE" && <span className="text-xs text-muted-foreground">Entrées hors achat (ex. retour restaurant → dépôt). Les achats passent par la Liste d&apos;achat ou une facture.</span>}
        <label className="flex items-center gap-1 text-xs text-muted-foreground">Date<input name="date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} className={inp} /></label>
        {type === "SORTIE" ? (
          <select name="categorieSortie" value={motif} onChange={(e) => setMotif(e.target.value as typeof motif)} className={inp}>
            <option value="">Motif de sortie…</option>
            <option value="PERTE">Perte</option>
            <option value="LIVRAISON_RESTAURANT">Livraison restaurant</option>
          </select>
        ) : (
          <input name="origine" placeholder="Motif (achat direct, don…)" className={`${inp} min-w-56 flex-1`} />
        )}
        {type === "SORTIE" && motif === "PERTE" && (
          <input name="raisonSortie" placeholder="Raison de la perte (obligatoire)" required className={`${inp} min-w-56 flex-1`} />
        )}
      </div>

      {Array.from({ length: nb }).map((_, i) => (
        <div key={i} className="flex items-center gap-2">
          <select name="articleId" defaultValue="" className={`${inp} min-w-64 flex-1`}>
            <option value="">— article —</option>
            {articles.map((a) => <option key={a.id} value={a.id}>{a.designation}</option>)}
          </select>
          <input name="quantite" type="number" step="0.001" min="0" placeholder="Qté" className={`${inp} w-28`} />
        </div>
      ))}
      <div className="flex items-center gap-3 pt-1">
        <button type="button" onClick={() => setNb((n) => n + 1)} className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">+ Ligne</button>
        <button disabled={isPending} className={`rounded-md px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50 ${type === "ENTREE" ? "bg-success" : "bg-destructive"}`}>{isPending ? "Enregistrement…" : type === "ENTREE" ? "Valider l'entrée" : "Valider la sortie"}</button>
        <BoutonReinitialiser estDirection={estDirection} onClick={reinitialiser} />
        <button type="button" onClick={() => setOuvert(false)} className="text-sm text-muted-foreground underline">Fermer</button>
      </div>
    </form>
  );
}

"use client";

import { useMemo, useState, useTransition } from "react";
import { modifierEnteteFacture } from "../actions";
import { estErreur } from "@/lib/action-lisible";
import { BoutonNeutre, BoutonApprouver } from "@/components/action-buttons";
import { ChoixRecherche } from "@/components/choix-recherche";
import { optionsFournisseurs } from "@/lib/recherche-options";

/**
 * « Corriger la facture » (Direction) : numéro, date, échéance, fournisseur et — seulement si rien n'en
 * dépend — montant. Le serveur compare aux valeurs de la facture, n'écrit que les différences et les
 * journalise avant → après ; ce formulaire ne fait que les proposer. Le montant est dans la devise de la facture.
 */
export function CorrigerEntete({ id, numero, date, echeance, fournisseurId, montant, symbole, montantBloque, fournisseurs }: {
  id: string; numero: string | null; date: string | null; echeance: string | null; fournisseurId: string | null;
  /** Montant courant, écrit à la française (« 1 234,50 »), dans la devise de la facture. */
  montant: string; symbole: string;
  /** Pourquoi le montant n'est pas modifiable (lignes, entrées en stock) ; null = modifiable. */
  montantBloque: string | null;
  fournisseurs: { id: string; nom: string }[];
}) {
  const [ouvert, setOuvert] = useState(false);
  const [n, setN] = useState(numero ?? "");
  const [d, setD] = useState(date ?? "");
  const [e, setE] = useState(echeance ?? "");
  const [f, setF] = useState(fournisseurId ?? "");
  const [m, setM] = useState(montant);
  const [erreur, setErreur] = useState<string | null>(null);
  const [fait, setFait] = useState<string[] | null>(null);
  const [isPending, start] = useTransition();
  const options = useMemo(() => optionsFournisseurs(fournisseurs), [fournisseurs]);
  const inp = "rounded-md border border-input bg-background px-2 py-1.5 text-sm";

  const enregistrer = () => {
    setErreur(null); setFait(null);
    start(async () => {
      const r = await modifierEnteteFacture(id, { numero: n, date: d, dateEcheance: e, fournisseurId: f, ...(montantBloque ? {} : { montant: m }) });
      if (estErreur(r)) { setErreur(r.erreur); return; }
      setFait(r.changements);
      setOuvert(false);
    });
  };

  if (!ouvert) {
    return (
      <div className="flex flex-col items-start gap-1">
        <BoutonNeutre onClick={() => { setOuvert(true); setFait(null); }}>Corriger la facture</BoutonNeutre>
        {fait && <span className="text-xs text-emerald-700" role="status">Corrigé — {fait.join(" ; ")}</span>}
      </div>
    );
  }
  return (
    <div className="w-full space-y-2 rounded-lg border bg-muted/20 p-3 text-sm" data-corriger-entete>
      <p className="font-medium">Corriger la facture <span className="font-normal text-muted-foreground">(journalisé avant → après ; la devise de la facture ne change pas)</span></p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">N° facture
          <input value={n} onChange={(x) => setN(x.target.value)} className={inp} aria-label="N° facture" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">Date de la facture
          <input type="date" value={d} onChange={(x) => setD(x.target.value)} className={inp} aria-label="Date de la facture" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">Échéance
          <input type="date" value={e} onChange={(x) => setE(x.target.value)} className={inp} aria-label="Échéance" />
        </label>
        <div className="flex flex-col gap-1 text-xs text-muted-foreground">Fournisseur
          <ChoixRecherche options={options} value={f} onChange={setF} aria-label="Fournisseur" className={inp} />
        </div>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">Montant ({symbole})
          <input value={m} onChange={(x) => setM(x.target.value)} disabled={!!montantBloque} inputMode="decimal" className={`${inp} disabled:opacity-60`} aria-label={`Montant (${symbole})`} />
          {montantBloque && <span className="text-[11px] text-amber-800">{montantBloque}</span>}
        </label>
      </div>
      <p className="text-[11px] text-muted-foreground">La date d&apos;une facture qui a fait entrer du stock ne se corrige pas ici (refus expliqué) ; une date n&apos;entre ni ne sort d&apos;un mois clôturé. Le libellé des mouvements déjà écrits n&apos;est pas réécrit.</p>
      <div className="flex flex-wrap items-center gap-2">
        <BoutonApprouver onClick={enregistrer} disabled={isPending}>{isPending ? "…" : "Enregistrer la correction"}</BoutonApprouver>
        <BoutonNeutre onClick={() => { setOuvert(false); setErreur(null); }}>Annuler</BoutonNeutre>
        {erreur && <span className="text-xs text-destructive" role="alert">{erreur}</span>}
      </div>
    </div>
  );
}

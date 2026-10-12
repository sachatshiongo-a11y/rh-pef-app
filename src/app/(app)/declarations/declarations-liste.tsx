"use client";

import { useState, useTransition } from "react";
import { BulkBar, useBulkSelection } from "@/components/bulk-bar";
import { BoutonNeutre, BoutonValider } from "@/components/action-buttons";
import { estErreur } from "@/lib/action-lisible";
import { formaterNombre } from "@/lib/montant";
import { marquerDeclarationsEnLot, type RapportMarquageLot } from "./actions";

export type LigneDeclarationEcran = {
  type: "CNSS" | "IPR" | "INPP" | "ONEM";
  libelle: string;
  detail: string;
  montantUSD: number;
  montantCDF: number;
  recalculUSD: number;
  /** Montant figé au marquage : date du marquage déjà formatée (ou "" si inconnue), null si rien n'est figé. */
  figeLe: string | null;
  ecartAvecFige: boolean;
  echeance: string;
  echeanceAValider: boolean;
  statut: "A_DECLARER" | "DECLARE" | "PAYE";
};

const LIBELLE_STATUT = { A_DECLARER: "À déclarer", DECLARE: "Déclaré", PAYE: "Payé" } as const;
const COULEUR_STATUT = { A_DECLARER: "bg-amber-100 text-amber-800", DECLARE: "bg-blue-100 text-blue-800", PAYE: "bg-green-100 text-green-800" } as const;
const usd = (n: number) => `${formaterNombre(n, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;
const cdf = (n: number) => `${formaterNombre(n, { maximumFractionDigits: 0 })} CDF`;

/**
 * Déclarations par organisme (CNSS, IPR, INPP, ONEM) : cases à cocher par ligne et actions groupées
 * « Marquer déclaré » / « Marquer payé » (Direction), avec confirmation — marquer FIGE le montant et un
 * paiement ne s'annule pas depuis cet écran. Cartes sur téléphone, tableau sur ordinateur ; un refus du
 * serveur (paie non validée, déjà payé) est nommé à l'écran.
 */
export function DeclarationsListe({ lignes, mois, annee, periode, provisoire, estAdmin, totalUSD, totalCDF }: {
  lignes: LigneDeclarationEcran[]; mois: number; annee: number; periode: string; provisoire: boolean; estAdmin: boolean; totalUSD: number; totalCDF: number;
}) {
  const { sel, toggle, clear, setAll } = useBulkSelection();
  const [note, setNote] = useState<{ ok: boolean; texte: string } | null>(null);
  const [enCours, demarrer] = useTransition();

  // Ce que chaque ligne permet — mêmes conditions qu'avant la liste groupée.
  const peutDeclarer = (l: LigneDeclarationEcran) => !provisoire && l.statut === "A_DECLARER";
  const peutPayer = (l: LigneDeclarationEcran) => (!provisoire || l.statut === "DECLARE") && l.statut !== "PAYE";
  const choisies = lignes.filter((l) => sel.has(l.type));
  const aDeclarer = choisies.filter(peutDeclarer);
  const aPayer = choisies.filter(peutPayer);

  function marquer(cibles: LigneDeclarationEcran[], statut: "DECLARE" | "PAYE") {
    if (cibles.length === 0) return;
    const total = cibles.reduce((t, l) => t + l.montantUSD, 0);
    const liste = cibles.map((l) => l.libelle).join(", ");
    const message = statut === "PAYE"
      ? `Marquer comme PAYÉ pour ${periode} : ${liste} (${usd(total)}) ? Le paiement sera enregistré et ne pourra plus être annulé depuis cet écran.`
      : `Marquer comme DÉCLARÉ pour ${periode} : ${liste} (${usd(total)}) ? Les montants sont figés à cet instant.`;
    if (!window.confirm(message)) return;
    setNote(null);
    demarrer(async () => {
      const r = await marquerDeclarationsEnLot(cibles.map((l) => l.type), mois, annee, statut);
      if (estErreur(r)) { setNote({ ok: false, texte: r.erreur }); return; }
      const rapport = r as RapportMarquageLot;
      clear();
      const verbe = statut === "PAYE" ? "marquée(s) payée(s)" : "marquée(s) déclarée(s)";
      setNote(rapport.echecs.length > 0
        ? { ok: false, texte: `${rapport.traitees} déclaration(s) ${verbe}, ${rapport.echecs.length} refusée(s) — ${rapport.echecs.join(" · ")}` }
        : { ok: true, texte: `${rapport.traitees} déclaration(s) ${verbe}.` });
    });
  }

  const actionsLigne = (l: LigneDeclarationEcran) => (
    <>
      {provisoire && l.statut === "A_DECLARER" && <span className="text-xs italic text-muted-foreground">Validez la paie d&apos;abord</span>}
      {peutDeclarer(l) && <BoutonNeutre disabled={enCours} onClick={() => marquer([l], "DECLARE")}>Marquer déclaré</BoutonNeutre>}
      {peutPayer(l) && <BoutonValider disabled={enCours} onClick={() => marquer([l], "PAYE")}>Marquer payé</BoutonValider>}
      {l.statut === "PAYE" && <span className="text-xs text-muted-foreground">—</span>}
    </>
  );
  const figeTexte = (l: LigneDeclarationEcran) => l.figeLe !== null && (
    <span className="block text-xs text-muted-foreground">figé au marquage{l.figeLe ? ` du ${l.figeLe}` : ""}</span>
  );
  const ecartTexte = (l: LigneDeclarationEcran) => l.figeLe !== null && l.ecartAvecFige && (
    <span className="block text-xs font-medium text-destructive">Recalcul d&apos;aujourd&apos;hui : {usd(l.recalculUSD)} — différent du montant déclaré</span>
  );

  return (
    <div className="space-y-3">
      {note && (
        <p role="status" className={`rounded-md border px-3 py-2 text-sm ${note.ok ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-amber-300 bg-amber-50 text-amber-900"}`}>{note.texte}</p>
      )}
      {estAdmin && (
        <BulkBar count={sel.size} total={lignes.length} onAll={(on) => setAll(lignes.map((l) => l.type), on)}>
          <BoutonNeutre disabled={enCours || aDeclarer.length === 0} onClick={() => marquer(aDeclarer, "DECLARE")}>Marquer déclaré ({aDeclarer.length})</BoutonNeutre>
          <BoutonValider disabled={enCours || aPayer.length === 0} onClick={() => marquer(aPayer, "PAYE")}>Marquer payé ({aPayer.length})</BoutonValider>
          <BoutonNeutre onClick={clear}>Désélectionner</BoutonNeutre>
        </BulkBar>
      )}

      {/* Téléphone : une carte par organisme. */}
      <div className="space-y-2 lg:hidden">
        {lignes.map((l) => (
          <div key={l.type} className={`rounded-xl border bg-card p-3 ${sel.has(l.type) ? "ring-1 ring-primary" : ""}`}>
            <div className="flex items-center gap-2">
              {estAdmin && <input type="checkbox" checked={sel.has(l.type)} onChange={() => toggle(l.type)} aria-label={`Sélectionner ${l.libelle}`} className="h-5 w-5 shrink-0" />}
              <span className="flex-1 font-medium">{l.libelle}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${COULEUR_STATUT[l.statut]}`}>{LIBELLE_STATUT[l.statut]}</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{l.detail}</p>
            <div className="mt-2 flex items-baseline justify-between gap-2">
              <span className="font-semibold tabular-nums">{usd(l.montantUSD)}{provisoire && l.figeLe === null && <span className="ml-1 text-xs font-normal italic text-amber-700">(provisoire)</span>}</span>
              <span className="text-xs text-muted-foreground">{cdf(l.montantCDF)}</span>
            </div>
            {figeTexte(l)}
            {ecartTexte(l)}
            <p className="mt-1 text-xs text-muted-foreground">Échéance {l.echeance}{l.echeanceAValider && <span className="ml-1 italic text-amber-700">(à valider)</span>}</p>
            {estAdmin && <div className="mt-2 flex flex-wrap items-center gap-2">{actionsLigne(l)}</div>}
          </div>
        ))}
        <div className="flex justify-between rounded-xl border-2 border-primary/40 bg-muted/30 px-3 py-2 font-semibold">
          <span>Total</span><span className="tabular-nums">{usd(totalUSD)} · {cdf(totalCDF)}</span>
        </div>
      </div>

      {/* Ordinateur : tableau. */}
      <div className="tableau-normal hidden rounded-lg border lg:block">
        <table className="w-full text-sm">
          <thead className="en-tete-collante bg-muted text-left">
            <tr>
              {estAdmin && <th className="w-8 px-3 py-2"><span className="sr-only">Sélection</span></th>}
              <th className="px-3 py-2">Organisme</th>
              <th className="px-3 py-2">Nature</th>
              <th className="px-3 py-2 text-right">Montant USD</th>
              <th className="px-3 py-2 text-right">Montant CDF</th>
              <th className="px-3 py-2">Échéance</th>
              <th className="px-3 py-2">Statut</th>
              {estAdmin && <th className="px-3 py-2 text-right">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {lignes.map((l) => (
              <tr key={l.type} className={`border-t align-top ${sel.has(l.type) ? "bg-primary/10" : ""}`}>
                {estAdmin && (
                  <td className="px-3 py-2"><input type="checkbox" checked={sel.has(l.type)} onChange={() => toggle(l.type)} aria-label={`Sélectionner ${l.libelle}`} /></td>
                )}
                <td className="px-3 py-2 font-medium">{l.libelle}</td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{l.detail}</td>
                <td className="px-3 py-2 text-right">
                  {usd(l.montantUSD)}
                  {provisoire && l.figeLe === null && <span className="ml-1 text-xs italic text-amber-700">(provisoire)</span>}
                  {figeTexte(l)}
                  {ecartTexte(l)}
                </td>
                <td className="px-3 py-2 text-right">{cdf(l.montantCDF)}</td>
                <td className="whitespace-nowrap px-3 py-2">
                  {l.echeance}
                  {l.echeanceAValider && <span className="ml-1 text-xs italic text-amber-700">(à valider)</span>}
                </td>
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${COULEUR_STATUT[l.statut]}`}>{LIBELLE_STATUT[l.statut]}</span>
                </td>
                {estAdmin && (
                  <td className="px-3 py-2"><div className="flex flex-wrap items-center justify-end gap-2">{actionsLigne(l)}</div></td>
                )}
              </tr>
            ))}
            <tr className="border-t-2 border-primary/40 bg-muted/30 font-semibold">
              {estAdmin && <td className="px-3 py-2" />}
              <td className="px-3 py-2">Total</td>
              <td className="px-3 py-2" />
              <td className="px-3 py-2 text-right">{usd(totalUSD)}</td>
              <td className="px-3 py-2 text-right">{cdf(totalCDF)}</td>
              <td className="px-3 py-2" />
              <td className="px-3 py-2" />
              {estAdmin && <td className="px-3 py-2" />}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

"use client";

import { useState, useTransition } from "react";
import { BulkBar, useBulkSelection } from "@/components/bulk-bar";
import { BoutonDanger, BoutonNeutre } from "@/components/action-buttons";
import { estErreur } from "@/lib/action-lisible";
import { supprimerJoursFeriesEnLot } from "./actions";

export type LigneFerie = { id: number; date: string; designation: string };

/**
 * Jours fériés (Direction) : cases à cocher et suppression groupée, avec confirmation — retirer un férié recale
 * les congés qui le couvrent. Le résultat (recalage par férié) s'affiche ; un refus du serveur aussi.
 */
export function JoursFeriesListe({ feries }: { feries: LigneFerie[] }) {
  const { sel, ids, toggle, clear, setAll } = useBulkSelection();
  const [note, setNote] = useState<{ ok: boolean; texte: string } | null>(null);
  const [enCours, demarrer] = useTransition();

  function retirer(cibles: LigneFerie[]) {
    if (cibles.length === 0) return;
    const liste = cibles.map((f) => `« ${f.designation} » (${f.date})`).join(", ");
    if (!window.confirm(`Supprimer ${cibles.length > 1 ? `${cibles.length} jours fériés` : "le jour férié"} ${liste} ? Les plannings, congés et paies ${cibles.length > 1 ? "les comptent" : "le comptent"} de nouveau comme des jours ordinaires.`)) return;
    setNote(null);
    demarrer(async () => {
      const r = await supprimerJoursFeriesEnLot(cibles.map((f) => f.id));
      if (estErreur(r)) { setNote({ ok: false, texte: r.erreur }); return; }
      const rapport = r as { traitees: number; messages: string[]; echecs: string[] };
      clear();
      setNote(rapport.echecs.length > 0
        ? { ok: false, texte: `${rapport.traitees} férié(s) retiré(s), ${rapport.echecs.length} refusé(s) — ${rapport.echecs.join(" · ")}` }
        : { ok: true, texte: rapport.messages.join(" ") || "Férié retiré." });
    });
  }

  return (
    <div className="space-y-2">
      {note && (
        <p role="status" className={`rounded-md border px-3 py-2 text-sm ${note.ok ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-amber-300 bg-amber-50 text-amber-900"}`}>{note.texte}</p>
      )}
      {feries.length > 0 && (
        <BulkBar count={sel.size} total={feries.length} onAll={(on) => setAll(feries.map((f) => String(f.id)), on)}>
          <BoutonDanger disabled={enCours} onClick={() => retirer(feries.filter((f) => sel.has(String(f.id))))}>✕ Supprimer ({ids.length})</BoutonDanger>
          <BoutonNeutre onClick={clear}>Désélectionner</BoutonNeutre>
        </BulkBar>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[24rem] text-sm">
          <tbody>
            {feries.map((f) => (
              <tr key={f.id} className={`border-t ${sel.has(String(f.id)) ? "bg-primary/10" : ""}`}>
                <td className="w-8 px-2 py-1.5">
                  <input type="checkbox" checked={sel.has(String(f.id))} onChange={() => toggle(String(f.id))} aria-label={`Sélectionner le férié ${f.designation} du ${f.date}`} />
                </td>
                <td className="px-2 py-1.5">{f.date}</td>
                <td className="px-2 py-1.5">{f.designation}</td>
                <td className="px-2 py-1.5 text-right">
                  <button type="button" disabled={enCours} onClick={() => retirer([f])} className="min-h-9 px-2 text-destructive underline disabled:opacity-50 max-lg:min-h-11">Supprimer</button>
                </td>
              </tr>
            ))}
            {feries.length === 0 && (
              <tr><td colSpan={4} className="px-2 py-4 text-center text-muted-foreground">Aucun jour férié enregistré.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

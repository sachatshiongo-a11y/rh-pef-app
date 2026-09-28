"use client";

import { useState, useTransition } from "react";
import { BoutonValider } from "@/components/action-buttons";
import { estErreur } from "@/lib/action-lisible";
import { demanderMonAttestation } from "./actions";

const inputCls = "w-full min-w-0 rounded-md border border-input bg-background px-3 py-2.5 text-base sm:text-sm outline-none focus:ring-2 focus:ring-ring";

/** « Demander une attestation » : type + motif facultatif. Le refus revient comme un message. */
export function FormulaireDemande({ types }: { types: { v: "TRAVAIL" | "STAGE"; label: string }[] }) {
  const [type, setType] = useState(types[0]?.v ?? "TRAVAIL");
  const [motif, setMotif] = useState("");
  const [avis, setAvis] = useState<{ ok: boolean; texte: string } | null>(null);
  const [enCours, demarrer] = useTransition();

  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        setAvis(null);
        demarrer(async () => {
          const r = await demanderMonAttestation(type, motif.trim() || null);
          if (estErreur(r)) return setAvis({ ok: false, texte: r.erreur });
          setMotif("");
          setAvis({ ok: true, texte: "Demande envoyée à la Direction. Vous serez prévenu(e) dès qu'elle y aura répondu." });
        });
      }}
    >
      <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">
        Type d&apos;attestation
        <select value={type} onChange={(e) => setType(e.target.value as typeof type)} className={inputCls}>
          {types.map((t) => <option key={t.v} value={t.v}>{t.label}</option>)}
        </select>
      </label>
      <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">
        <span>Pour quoi faire ? <span className="font-normal text-muted-foreground">(facultatif)</span></span>
        <input value={motif} onChange={(e) => setMotif(e.target.value)} maxLength={200} placeholder="ex. dossier bancaire" className={inputCls} />
      </label>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <BoutonValider type="submit" disabled={enCours} className="min-h-11 w-full justify-center sm:min-h-0 sm:w-auto">{enCours ? "Envoi…" : "Demander l'attestation"}</BoutonValider>
        {avis && (
          <p role="status" className={`text-sm ${avis.ok ? "text-emerald-700" : "text-destructive"}`}>{avis.texte}</p>
        )}
      </div>
    </form>
  );
}

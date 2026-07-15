"use client";

import { useState, useTransition } from "react";
import { entreeListeAchat } from "./actions";
import { BoutonReinitialiser } from "../_rapport/bouton-reinitialiser";
import { estErreur } from "@/lib/action-lisible";

type Art = { id: string; designation: string };
const inp = "rounded border border-input bg-background px-2 py-1 text-sm";

export function ListeAchatForm({ articles, taux, estDirection = false }: { articles: Art[]; taux: number; estDirection?: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; texte: string } | null>(null);
  // Lignes contrôlées : le prix unitaire (facultatif) répercute quantité × PU sur le montant.
  type Ligne = { qte: string; pu: string; montant: string };
  const vide = (): Ligne => ({ qte: "", pu: "", montant: "" });
  const [lignes, setLignes] = useState<Ligne[]>([vide(), vide(), vide(), vide()]);
  const [devise, setDevise] = useState<"USD" | "CDF">("USD");
  const [cle, setCle] = useState(0);
  const reinitialiser = () => { setMsg(null); setLignes([vide(), vide(), vide(), vide()]); setDevise("USD"); setCle((c) => c + 1); };

  const majLigne = (i: number, patch: Partial<Ligne>) =>
    setLignes((ls) =>
      ls.map((l, j) => {
        if (j !== i) return l;
        const maj = { ...l, ...patch };
        // Quantité ou PU modifiés et PU renseigné → montant recalculé (modifiable ensuite à la main).
        if (("qte" in patch || "pu" in patch) && maj.pu !== "") {
          const q = Number(maj.qte.replace(",", "."));
          const pu = Number(maj.pu.replace(",", "."));
          maj.montant = q > 0 && pu > 0 ? String(Math.round(q * pu * 100) / 100) : "";
        }
        return maj;
      })
    );

  const submit = (fd: FormData) => {
    setMsg(null);
    startTransition(async () => {
      const r = await entreeListeAchat(fd);
      if (estErreur(r)) { setMsg({ ok: false, texte: r.erreur }); return; }
      setMsg({ ok: true, texte: "Entrées enregistrées : le stock a été mis à jour." });
      setLignes([vide(), vide(), vide(), vide()]);
      setCle((c) => c + 1);
    });
  };

  return (
    <form key={cle} action={submit} className="space-y-3">
      {msg && (
        <p className={`rounded-md border px-3 py-2 text-sm ${msg.ok ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-destructive/40 bg-destructive/10 text-destructive"}`}>
          {msg.texte}
        </p>
      )}

      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Origine / libellé (optionnel)</span>
          <input name="origine" placeholder="Liste d'achat semaine…" className={inp} />
        </label>
        <div className="text-sm">
          <span className="text-muted-foreground">Devise du montant</span>
          <div className="mt-1 inline-flex overflow-hidden rounded-md border">
            <button type="button" onClick={() => setDevise("USD")} className={`px-3 py-1.5 ${devise === "USD" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>USD</button>
            <button type="button" onClick={() => setDevise("CDF")} className={`px-3 py-1.5 ${devise === "CDF" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>CDF (FC)</button>
          </div>
          <input type="hidden" name="devise" value={devise} />
        </div>
        {devise === "CDF" && <span className="pb-1.5 text-xs text-muted-foreground">Taux : 1 USD = {taux.toLocaleString("fr-FR")} FC (converti automatiquement)</span>}
      </div>

      <div className="space-y-2">
        {/* En-têtes de colonnes : ordinateur uniquement (sur mobile chaque champ est étiqueté par son placeholder). */}
        <div className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex">
          <span className="flex-1">Article</span>
          <span className="w-24">Quantité</span>
          <span className="w-28">Prix unit. ({devise})</span>
          <span className="w-32">Montant payé ({devise})</span>
        </div>
        {lignes.map((l, i) => (
          <div key={i} className="grid grid-cols-3 gap-2 rounded-lg border p-2 sm:flex sm:items-center sm:rounded-none sm:border-0 sm:p-0">
            <select name="articleId" defaultValue="" className={`${inp} col-span-3 min-w-0 sm:flex-1`}>
              <option value="">— article —</option>
              {articles.map((a) => <option key={a.id} value={a.id}>{a.designation}</option>)}
            </select>
            <input name="quantite" type="number" step="0.001" min="0" placeholder="Quantité" value={l.qte} onChange={(e) => majLigne(i, { qte: e.target.value })} className={`${inp} min-w-0 sm:w-24`} />
            {/* Prix unitaire FACULTATIF : jamais envoyé au serveur, il sert à remplir le montant. */}
            <input type="number" step="0.01" min="0" placeholder={`PU ${devise}`} title="Prix unitaire (facultatif) — remplit le montant : quantité × PU" value={l.pu} onChange={(e) => majLigne(i, { pu: e.target.value })} className={`${inp} min-w-0 sm:w-28`} />
            <input name="montant" type="number" step="0.01" min="0" placeholder={`Montant ${devise}`} value={l.montant} onChange={(e) => majLigne(i, { montant: e.target.value })} className={`${inp} min-w-0 sm:w-32`} />
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <button type="button" onClick={() => setLignes((ls) => [...ls, vide()])} className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">+ Ligne</button>
        <button disabled={isPending} className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
          {isPending ? "Enregistrement…" : "Valider l'entrée en stock"}
        </button>
        <BoutonReinitialiser estDirection={estDirection} onClick={reinitialiser} />
      </div>
      <p className="text-xs text-muted-foreground">Prix unitaire et montant sont facultatifs — le prix unitaire remplit le montant (quantité × PU), ajustable à la main. En CDF, le montant est converti en USD au taux courant et enregistré sur le mouvement (il nourrit l&apos;évolution du prix d&apos;achat).</p>
    </form>
  );
}

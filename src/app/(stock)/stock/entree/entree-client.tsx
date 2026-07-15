"use client";

import { useState, useTransition } from "react";
import { entreeListeAchat } from "./actions";
import { BoutonReinitialiser } from "../_rapport/bouton-reinitialiser";
import { estErreur } from "@/lib/action-lisible";

type Art = { id: string; designation: string; unite: string | null; domaine: string; prix: string | null };
const inp = "rounded border border-input bg-background px-2 py-1 text-sm";

export function ListeAchatForm({ articles, taux, estDirection = false }: { articles: Art[]; taux: number; estDirection?: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; texte: string } | null>(null);
  // Lignes contrôlées : article du CATALOGUE (désignation/unité reprises) ou ÉCRITURE LIBRE
  // (nouvel article, créé automatiquement au catalogue dans le domaine choisi).
  // Le prix unitaire (facultatif) répercute quantité × PU sur le montant.
  type Ligne = { articleId: string; designation: string; unite: string; domaine: string; qte: string; pu: string; montant: string };
  const vide = (): Ligne => ({ articleId: "", designation: "", unite: "", domaine: "NOURRITURE", qte: "", pu: "", montant: "" });
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

  const choisirArticle = (i: number, articleId: string) => {
    const a = articles.find((x) => x.id === articleId);
    setLignes((ls) =>
      ls.map((l, j) =>
        j !== i
          ? l
          : a
          ? { ...l, articleId, designation: a.designation, unite: a.unite ?? "", domaine: a.domaine, pu: devise === "USD" && a.prix ? a.prix : l.pu }
          : { ...l, articleId: "", designation: "", unite: "" }
      )
    );
  };

  const submit = (fd: FormData) => {
    setMsg(null);
    startTransition(async () => {
      const r = await entreeListeAchat(fd);
      if (estErreur(r)) { setMsg({ ok: false, texte: r.erreur }); return; }
      setMsg({
        ok: true,
        texte: `Entrées enregistrées : le stock a été mis à jour.${r.crees.length ? ` ${r.crees.length} nouvel(aux) article(s) créé(s) au catalogue : ${r.crees.join(", ")}.` : ""}`,
      });
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
        <div className="hidden items-center gap-2 text-xs text-muted-foreground lg:flex">
          <span className="flex-1">Article (catalogue)</span>
          <span className="w-40">Désignation (libre si nouveau)</span>
          <span className="w-20">Unité</span>
          <span className="w-28">Domaine</span>
          <span className="w-20">Qté</span>
          <span className="w-24">P.U. ({devise})</span>
          <span className="w-28">Montant ({devise})</span>
          <span className="w-7" />
        </div>
        {lignes.map((l, i) => {
          const libre = !l.articleId;
          return (
            <div key={i} className="grid grid-cols-3 gap-2 rounded-lg border p-2 lg:flex lg:items-center lg:rounded-none lg:border-0 lg:p-0">
              <select name="articleId" value={l.articleId} onChange={(e) => choisirArticle(i, e.target.value)} className={`${inp} col-span-3 min-w-0 lg:flex-1`}>
                <option value="">— libre —</option>
                {articles.map((a) => <option key={a.id} value={a.id}>{a.designation}</option>)}
              </select>
              <input name="designation" placeholder="Désignation" value={l.designation} onChange={(e) => majLigne(i, { designation: e.target.value })} readOnly={!libre} className={`${inp} col-span-3 min-w-0 ${!libre ? "text-muted-foreground" : ""} lg:w-40`} />
              <input name="unite" placeholder="Kg…" value={l.unite} onChange={(e) => majLigne(i, { unite: e.target.value })} readOnly={!libre} className={`${inp} min-w-0 ${!libre ? "text-muted-foreground" : ""} lg:w-20`} />
              {/* Domaine du NOUVEL article (création automatique au catalogue) — figé si article existant. */}
              <select name="domaine" value={l.domaine} onChange={(e) => majLigne(i, { domaine: e.target.value })} disabled={!libre} className={`${inp} col-span-2 min-w-0 disabled:opacity-60 lg:w-28`}>
                <option value="NOURRITURE">Nourriture</option>
                <option value="BOISSON">Boisson</option>
                <option value="AUTRE">Autre</option>
              </select>
              {!libre && <input type="hidden" name="domaine" value={l.domaine} />}
              <input name="quantite" type="number" step="0.001" min="0" placeholder="Qté" value={l.qte} onChange={(e) => majLigne(i, { qte: e.target.value })} className={`${inp} min-w-0 lg:w-20`} />
              {/* Prix unitaire FACULTATIF : jamais envoyé au serveur, il sert à remplir le montant. */}
              <input type="number" step="0.01" min="0" placeholder={`PU ${devise}`} title="Prix unitaire (facultatif) — remplit le montant : quantité × PU" value={l.pu} onChange={(e) => majLigne(i, { pu: e.target.value })} className={`${inp} min-w-0 lg:w-24`} />
              <input name="montant" type="number" step="0.01" min="0" placeholder={`Montant ${devise}`} value={l.montant} onChange={(e) => majLigne(i, { montant: e.target.value })} className={`${inp} min-w-0 lg:w-28`} />
              <button type="button" onClick={() => setLignes((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : ls.map((x, j) => (j === i ? vide() : x))))} aria-label="Retirer la ligne" title="Retirer la ligne" className="rounded-md border px-2 py-1 text-sm text-muted-foreground hover:bg-destructive/10 hover:text-destructive lg:w-7">✕</button>
            </div>
          );
        })}
      </div>

      <div className="flex items-center gap-3">
        <button type="button" onClick={() => setLignes((ls) => [...ls, vide()])} className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">+ Ligne</button>
        <button disabled={isPending} className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
          {isPending ? "Enregistrement…" : "Valider l'entrée en stock"}
        </button>
        <BoutonReinitialiser estDirection={estDirection} onClick={reinitialiser} />
      </div>
      <p className="text-xs text-muted-foreground">Article du catalogue OU désignation libre : un nouvel article est <b>créé automatiquement au catalogue</b> (domaine choisi, unité et prix de cet achat comme référence) — une désignation identique retrouve l&apos;article existant. Prix unitaire et montant sont facultatifs — le PU remplit le montant (quantité × PU), ajustable. En CDF, converti en USD au taux courant (nourrit l&apos;évolution du prix d&apos;achat).</p>
    </form>
  );
}

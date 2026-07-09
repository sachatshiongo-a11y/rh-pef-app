"use client";

import { memo, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { creerFournisseur, modifierFournisseur, supprimerFournisseur, fusionnerFournisseurs } from "./actions";

export type FournRow = {
  id: string; nom: string; contactNom: string; telephone: string; ville: string;
  rccm: string; delaiPaiement: string; delaiLivraison: string; nbArticles: number;
};
const inp = "w-full rounded border border-input bg-background px-1.5 py-1 text-xs";
const CH = ["nom", "contactNom", "telephone", "ville", "rccm", "delaiPaiement", "delaiLivraison"] as const;
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function FournisseursClient({ fournisseurs, estDirection }: { fournisseurs: FournRow[]; estDirection: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  const [ajout, setAjout] = useState(false);
  const [fusion, setFusion] = useState(false);
  const [source, setSource] = useState("");
  const [cible, setCible] = useState("");
  const [q, setQ] = useState("");

  const tries = useMemo(() => [...fournisseurs].sort((a, b) => a.nom.localeCompare(b.nom, "fr")), [fournisseurs]);
  const fusionner = () => {
    const s = fournisseurs.find((f) => f.id === source);
    const c = fournisseurs.find((f) => f.id === cible);
    if (!s || !c || s.id === c.id) { setErreur("Choisissez deux fournisseurs différents."); return; }
    if (!confirm(`Fusionner « ${s.nom} » dans « ${c.nom} » ?\n\nTous les articles, bons de commande et factures de « ${s.nom} » seront rattachés à « ${c.nom} », les coordonnées manquantes complétées, puis « ${s.nom} » sera supprimé. Action irréversible.`)) return;
    run(async () => { await fusionnerFournisseurs(s.id, c.id); setFusion(false); setSource(""); setCible(""); });
  };

  const run = (fn: () => Promise<void>) => {
    setErreur(null);
    startTransition(async () => { try { await fn(); } catch (e) { setErreur(e instanceof Error ? e.message : "Erreur."); } });
  };
  const save = async (id: string, name: string, value: string) => {
    const fd = new FormData(); fd.set(name, value);
    try { await modifierFournisseur(id, fd); } catch (e) { setErreur(e instanceof Error ? e.message : "Erreur."); }
  };
  const supprimer = (id: string, nom: string) => {
    if (!confirm(`Supprimer le fournisseur « ${nom} » ? Les articles/factures liés seront détachés.`)) return;
    run(() => supprimerFournisseur(id));
  };

  const visibles = useMemo(() => {
    const nq = norm(q.trim());
    if (!nq) return fournisseurs;
    return fournisseurs.filter((f) => norm(`${f.nom} ${f.contactNom} ${f.ville}`).includes(nq));
  }, [fournisseurs, q]);

  return (
    <div className="space-y-3">
      {erreur && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erreur}</p>}
      {!estDirection && <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">Consultation — seule la Direction peut ajouter, modifier ou supprimer un fournisseur.</p>}

      <div className="flex flex-wrap items-center gap-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher (nom, contact, ville)…" className="w-full max-w-xs rounded-md border border-input bg-background px-3 py-1.5 text-sm" />
        <span className="text-xs text-muted-foreground">{visibles.length} / {fournisseurs.length} fournisseur(s)</span>
        {estDirection && (
          <div className="ml-auto flex items-center gap-2">
            <button onClick={() => { setFusion((v) => !v); setAjout(false); }} className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">
              {fusion ? "Fermer" : "⤵ Fusionner"}
            </button>
            <button onClick={() => { setAjout((v) => !v); setFusion(false); }} className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">
              {ajout ? "Fermer" : "+ Ajouter un fournisseur"}
            </button>
          </div>
        )}
      </div>

      {fusion && estDirection && (
        <div className="rounded-lg border bg-muted/20 p-3">
          <div className="text-sm font-medium">Fusionner deux fournisseurs</div>
          <p className="mt-0.5 text-xs text-muted-foreground">Le fournisseur à fusionner est supprimé ; ses articles, bons de commande et factures passent sur celui à conserver, dont les coordonnées manquantes sont complétées.</p>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-0.5 text-[11px] font-medium text-muted-foreground">À fusionner (supprimé)
              <select value={source} onChange={(e) => setSource(e.target.value)} className="w-56 rounded border border-input bg-background px-2 py-1.5 text-sm text-foreground">
                <option value="">— choisir —</option>
                {tries.map((f) => <option key={f.id} value={f.id} disabled={f.id === cible}>{f.nom}</option>)}
              </select>
            </label>
            <span className="pb-2 text-muted-foreground">→</span>
            <label className="flex flex-col gap-0.5 text-[11px] font-medium text-muted-foreground">À conserver
              <select value={cible} onChange={(e) => setCible(e.target.value)} className="w-56 rounded border border-input bg-background px-2 py-1.5 text-sm text-foreground">
                <option value="">— choisir —</option>
                {tries.map((f) => <option key={f.id} value={f.id} disabled={f.id === source}>{f.nom}</option>)}
              </select>
            </label>
            <button onClick={fusionner} disabled={isPending || !source || !cible} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">Fusionner</button>
          </div>
        </div>
      )}

      {ajout && estDirection && (
        <form action={(fd) => run(async () => { await creerFournisseur(fd); setAjout(false); })} className="grid grid-cols-2 gap-2 rounded-lg border p-3 md:grid-cols-4">
          <input name="nom" placeholder="Nom *" required className={inp} />
          <input name="contactNom" placeholder="Contact" className={inp} />
          <input name="telephone" placeholder="Téléphone" className={inp} />
          <input name="email" placeholder="Email" className={inp} />
          <input name="ville" placeholder="Ville" className={inp} />
          <input name="pays" placeholder="Pays" defaultValue="République démocratique du Congo" className={inp} />
          <input name="rccm" placeholder="RCCM" className={inp} />
          <input name="idNational" placeholder="ID National" className={inp} />
          <input name="delaiPaiement" placeholder="Délai paiement" className={inp} />
          <input name="delaiLivraison" placeholder="Délai livraison" className={inp} />
          <input name="modePaiement" placeholder="Mode paiement" className={inp} />
          <input name="produits" placeholder="Produits fournis" className={inp} />
          <button disabled={isPending} className="col-span-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50 md:col-span-4">Créer le fournisseur</button>
        </form>
      )}

      {/* Mobile : cartes éditables (enregistrement au blur, comme le tableur). */}
      <div className="space-y-2 lg:hidden">
        {visibles.map((f) => (
          <CarteFournisseur key={f.id} f={f} estDirection={estDirection} onSave={save} onDelete={supprimer} />
        ))}
        {visibles.length === 0 && <p className="rounded-xl border p-6 text-center text-sm text-muted-foreground">Aucun fournisseur.</p>}
      </div>

      {/* Ordinateur : tableur. */}
      <div className="hidden max-h-[70vh] overflow-auto rounded-lg border lg:block">
        <table className="w-full min-w-[64rem] text-sm">
          <thead className="sticky top-0 z-10 bg-muted text-left shadow-sm">
            <tr className="[&>th]:border-b [&>th]:px-2 [&>th]:py-2 [&>th]:font-semibold">
              <th>Nom</th>
              <th>Contact</th>
              <th>Téléphone</th>
              <th>Ville</th>
              <th>RCCM</th>
              <th>Délai paiement</th>
              <th>Délai livraison</th>
              <th className="text-right">Articles</th>
              <th></th>
            </tr>
          </thead>
          <tbody className="[&>tr>td]:border-b [&>tr>td]:px-2 [&>tr>td]:py-1">
            {visibles.map((f) => (
              <LigneFournisseur key={f.id} f={f} estDirection={estDirection} onSave={save} onDelete={supprimer} />
            ))}
            {visibles.length === 0 && <tr><td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">Aucun fournisseur.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const LigneFournisseur = memo(function LigneFournisseur({
  f, estDirection, onSave, onDelete,
}: {
  f: FournRow; estDirection: boolean;
  onSave: (id: string, name: string, value: string) => Promise<void>;
  onDelete: (id: string, nom: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const write = (name: string, value: string, prev: string) => {
    if (value === prev) return;
    setBusy(true);
    onSave(f.id, name, value).finally(() => setBusy(false));
  };

  return (
    <tr className={`hover:bg-accent/40 even:bg-muted/25 ${busy ? "opacity-60" : ""}`}>
      {CH.map((c) => (
        <td key={c}>
          {estDirection
            ? <input defaultValue={f[c]} onBlur={(e) => write(c, e.target.value, f[c])} className={inp} />
            : <span className={c === "nom" ? "font-medium" : "text-muted-foreground"}>{f[c] || "—"}</span>}
        </td>
      ))}
      <td className="text-right">{f.nbArticles}</td>
      <td className="whitespace-nowrap text-right">
        <Link href={`/stock/fournisseurs/${f.id}`} className="text-xs font-medium text-primary underline">Fiche →</Link>
        {estDirection && <button onClick={() => onDelete(f.id, f.nom)} className="ml-3 text-xs text-destructive underline">Suppr.</button>}
      </td>
    </tr>
  );
});

const LABELS: Record<(typeof CH)[number], string> = {
  nom: "Nom", contactNom: "Contact", telephone: "Téléphone", ville: "Ville",
  rccm: "RCCM", delaiPaiement: "Délai paiement", delaiLivraison: "Délai livraison",
};

/** Carte éditable d'un fournisseur — équivalent mobile de LigneFournisseur (blur = enregistrement). */
const CarteFournisseur = memo(function CarteFournisseur({
  f, estDirection, onSave, onDelete,
}: {
  f: FournRow; estDirection: boolean;
  onSave: (id: string, name: string, value: string) => Promise<void>;
  onDelete: (id: string, nom: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const write = (name: string, value: string, prev: string) => {
    if (value === prev) return;
    setBusy(true);
    onSave(f.id, name, value).finally(() => setBusy(false));
  };
  const champ = "flex flex-col gap-0.5 text-[11px] font-medium text-muted-foreground";

  return (
    <div className={`rounded-xl border bg-card p-3 ${busy ? "opacity-60" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        {estDirection
          ? <input defaultValue={f.nom} onBlur={(e) => write("nom", e.target.value, f.nom)} placeholder="Nom" className={`${inp} !py-1.5 !text-sm font-semibold`} />
          : <span className="font-semibold">{f.nom || "—"}</span>}
        <Link href={`/stock/fournisseurs/${f.id}`} className="shrink-0 whitespace-nowrap rounded-full border border-primary/40 bg-primary/5 px-2.5 py-1 text-xs font-medium text-primary hover:bg-accent">Fiche →</Link>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {(["contactNom", "telephone", "ville", "rccm", "delaiPaiement", "delaiLivraison"] as const).map((c) => (
          <label key={c} className={champ}>{LABELS[c]}
            {estDirection
              ? <input defaultValue={f[c]} onBlur={(e) => write(c, e.target.value, f[c])} className={`${inp} !py-1.5`} />
              : <span className="rounded border border-transparent px-1.5 py-1 text-xs text-foreground">{f[c] || "—"}</span>}
          </label>
        ))}
      </div>
      {estDirection && (
        <div className="mt-2 text-right">
          <button onClick={() => onDelete(f.id, f.nom)} className="text-xs text-destructive underline">Supprimer</button>
        </div>
      )}
    </div>
  );
});

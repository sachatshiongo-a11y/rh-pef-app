"use client";

import { useRef, useState, useTransition } from "react";
import { creerFactureAvecLignes, analyserFacturePDF, type AnalyseFacture } from "../actions";
import { estErreur } from "@/lib/action-lisible";

type Art = { id: string; designation: string; prix: string | null; unite: string | null };
type Four = { id: string; nom: string; delaiJours: number | null };
type BonLigne = { articleId: string | null; designation: string; unite: string | null; quantite: string; prix: string };
type Bon = { id: string; numero: string; fournisseurId: string | null; fournisseurNom: string; delaiJours: number | null; lignes: BonLigne[] };
type Ligne = { articleId: string; designation: string; unite: string; quantite: string; prix: string };

const inp = "rounded border border-input bg-background px-2 py-1 text-sm";
const vide = (): Ligne => ({ articleId: "", designation: "", unite: "", quantite: "", prix: "" });

export function NouvelleFactureForm({ articles, fournisseurs, bons, bcInitial }: { articles: Art[]; fournisseurs: Four[]; bons: Bon[]; bcInitial: string | null }) {
  const bon0 = bons.find((b) => b.id === bcInitial) ?? null;
  const lignesDeBon = (b: Bon | null): Ligne[] =>
    b && b.lignes.length ? b.lignes.map((l) => ({ articleId: l.articleId ?? "", designation: l.designation, unite: l.unite ?? "", quantite: l.quantite, prix: l.prix })) : [vide(), vide(), vide()];

  const [erreur, setErreur] = useState<string | null>(null);
  const [doublon, setDoublon] = useState<string | null>(null);
  const [isPending, start] = useTransition();
  const [bonId, setBonId] = useState(bon0?.id ?? "");
  const [fournisseurId, setFournisseurId] = useState(bon0?.fournisseurId ?? "");
  const [fournisseurNom, setFournisseurNom] = useState(bon0?.fournisseurNom ?? "");
  const [numero, setNumero] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [echeance, setEcheance] = useState("");
  const [lignes, setLignes] = useState<Ligne[]>(lignesDeBon(bon0));
  const pdfRef = useRef<HTMLInputElement>(null);
  const [analysing, setAnalysing] = useState(false);
  const [analyse, setAnalyse] = useState<AnalyseFacture | null>(null);
  // Coordonnées d'un nouveau fournisseur à créer (renseignées uniquement si aucun proche n'est trouvé).
  const [coord, setCoord] = useState<AnalyseFacture["fournisseur"] | null>(null);

  const lirePdf = () => {
    const file = pdfRef.current?.files?.[0];
    if (!file) { setErreur("Sélectionnez d’abord un fichier PDF."); return; }
    setErreur(null);
    setAnalysing(true);
    const fd = new FormData();
    fd.set("facturePdf", file);
    analyserFacturePDF(fd)
      .then((r) => {
        if (estErreur(r)) { setErreur(r.erreur); return; }
        setAnalyse(r);
        if (r.date) setDate(r.date);
        if (r.numero) setNumero(r.numero);
        // Lignes détaillées lues sur la facture (article rapproché du catalogue + quantité + prix) ;
        // à défaut, une ligne unique avec le montant total.
        if (r.lignes.length > 0) {
          setLignes(r.lignes.map((l) => ({ articleId: l.articleId ?? "", designation: l.designation, unite: l.unite ?? "", quantite: String(l.quantite), prix: String(l.prixUnitaireUSD) })));
        } else if (r.montant != null) {
          setLignes([{ articleId: "", designation: "Facture (voir PDF joint)", unite: "", quantite: "1", prix: String(r.montant) }]);
        }
        // Fournisseur : proche existant → on l'associe ; sinon on prépare la création automatique.
        if (r.match) { setFournisseurId(r.match.id); setFournisseurNom(r.match.nom); setCoord(null); }
        else if (r.fournisseur.nom) { setFournisseurId(""); setFournisseurNom(r.fournisseur.nom); setCoord(r.fournisseur); }
      })
      .catch((e) => setErreur(e instanceof Error ? e.message : "Lecture du PDF échouée."))
      .finally(() => setAnalysing(false));
  };

  const maj = (i: number, patch: Partial<Ligne>) => setLignes((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const choisirArticle = (i: number, articleId: string) => {
    const a = articles.find((x) => x.id === articleId);
    maj(i, { articleId, designation: a?.designation ?? "", unite: a?.unite ?? "", prix: a?.prix ?? "" });
  };

  const calcEcheance = (dateStr: string, delai: number | null) => {
    if (!dateStr || delai == null) return;
    const dt = new Date(dateStr);
    dt.setDate(dt.getDate() + delai);
    setEcheance(dt.toISOString().slice(0, 10));
  };

  const choisirBon = (id: string) => {
    setBonId(id);
    const b = bons.find((x) => x.id === id) ?? null;
    if (b) {
      if (b.fournisseurId) setFournisseurId(b.fournisseurId);
      setFournisseurNom(b.fournisseurNom);
      if (b.lignes.length) setLignes(lignesDeBon(b));
      calcEcheance(date, b.delaiJours);
    }
  };

  const choisirFournisseur = (id: string) => {
    setFournisseurId(id);
    const f = fournisseurs.find((x) => x.id === id);
    if (f) { setFournisseurNom(f.nom); calcEcheance(date, f.delaiJours); }
  };

  const total = lignes.reduce((t, l) => t + (Number(l.quantite) || 0) * (Number(l.prix) || 0), 0);

  const submit = (fd: FormData) => {
    setErreur(null); setDoublon(null);
    start(async () => {
      let r: Awaited<ReturnType<typeof creerFactureAvecLignes>>;
      try { r = await creerFactureAvecLignes(fd); }
      catch (e) {
        // redirect() (succès) lève une exception interne de Next : ne pas l'afficher comme erreur.
        const d = e as { digest?: string };
        if ((e instanceof Error && e.message === "NEXT_REDIRECT") || d?.digest?.startsWith?.("NEXT_REDIRECT")) return;
        throw e;
      }
      if (!estErreur(r)) return;
      if (r.erreur.startsWith("DOUBLON_POSSIBLE|")) setDoublon(r.erreur.slice("DOUBLON_POSSIBLE|".length));
      else setErreur(r.erreur);
    });
  };

  return (
    <form action={submit} className="space-y-4">
      {erreur && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erreur}</p>}
      {doublon && (
        <div className="rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <p className="font-semibold">⚠ Achat peut-être déjà saisi</p>
          <p className="mt-1">{doublon}</p>
          <button type="submit" name="forcerDoublons" value="1" disabled={isPending} className="mt-2 rounded-md border border-amber-500 bg-amber-100 px-3 py-1.5 text-xs font-semibold hover:bg-amber-200 disabled:opacity-50">
            Enregistrer quand même (le stock sera compté en plus)
          </button>
        </div>
      )}

      <div className="rounded-lg border bg-muted/20 p-3">
        <div className="text-sm font-medium">Joindre le PDF de la facture <span className="font-normal text-muted-foreground">(facultatif)</span></div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input ref={pdfRef} type="file" name="facturePdf" accept="application/pdf,.pdf" onChange={() => { setAnalyse(null); setCoord(null); }} className="text-xs" />
          <button type="button" onClick={lirePdf} disabled={analysing} className="rounded-md border px-3 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50">
            {analysing ? "Lecture…" : "📄 Lire le PDF (pré-remplir)"}
          </button>
        </div>
        {analyse && (
          <div className="mt-2 space-y-1 text-xs text-muted-foreground">
            <p>Extrait : {analyse.montant != null ? `${analyse.montant} $` : "montant ?"} · {analyse.date ?? "date ?"}{analyse.numero ? ` · n° ${analyse.numero}` : ""} — <span className="font-medium">à vérifier</span> (le PDF joint reste la source de vérité).</p>
            {analyse.match ? (
              <p className="text-emerald-700">Fournisseur : associé à <span className="font-medium">« {analyse.match.nom} »</span> (proche de « {analyse.fournisseur.nom} » lu).</p>
            ) : analyse.fournisseur.nom ? (
              <p className="text-sky-700">
                Nouveau fournisseur <span className="font-medium">« {analyse.fournisseur.nom} »</span> — sera créé à l’enregistrement
                {[analyse.fournisseur.rccm && `RCCM ${analyse.fournisseur.rccm}`, analyse.fournisseur.telephone && `tél. ${analyse.fournisseur.telephone}`, analyse.fournisseur.ville].filter(Boolean).length
                  ? ` (${[analyse.fournisseur.rccm && `RCCM ${analyse.fournisseur.rccm}`, analyse.fournisseur.telephone && `tél. ${analyse.fournisseur.telephone}`, analyse.fournisseur.ville].filter(Boolean).join(" · ")})`
                  : ""}.
              </p>
            ) : (
              <p>Fournisseur non détecté — renseignez-le à la main.</p>
            )}
            {analyse.lignes.length > 0 && (
              <p>{analyse.lignes.length} ligne(s) lue(s), dont <span className="font-medium">{analyse.lignes.filter((l) => l.articleId).length}</span> rapprochée(s) d’un article du catalogue — vérifiez le tableau ci-dessous.</p>
            )}
          </div>
        )}
      </div>

      {/* Coordonnées d'un nouveau fournisseur détecté (créé à l'enregistrement si aucun n'est sélectionné). */}
      {!fournisseurId && coord && (
        <>
          <input type="hidden" name="nf_rccm" value={coord.rccm ?? ""} />
          <input type="hidden" name="nf_idNational" value={coord.idNational ?? ""} />
          <input type="hidden" name="nf_adresse" value={coord.adresse ?? ""} />
          <input type="hidden" name="nf_telephone" value={coord.telephone ?? ""} />
          <input type="hidden" name="nf_email" value={coord.email ?? ""} />
          <input type="hidden" name="nf_ville" value={coord.ville ?? ""} />
        </>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Bon de commande lié (facultatif)</span>
          <select value={bonId} onChange={(e) => choisirBon(e.target.value)} className={inp}>
            <option value="">— aucun —</option>
            {bons.map((b) => <option key={b.id} value={b.id}>{b.numero} · {b.fournisseurNom}</option>)}
          </select>
          <input type="hidden" name="bonDeCommandeId" value={bonId} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Fournisseur *</span>
          <select value={fournisseurId} onChange={(e) => choisirFournisseur(e.target.value)} className={inp}>
            <option value="">— catalogue —</option>
            {fournisseurs.map((f) => <option key={f.id} value={f.id}>{f.nom}</option>)}
          </select>
          <input type="hidden" name="fournisseurId" value={fournisseurId} />
          <input name="fournisseurNom" value={fournisseurNom} onChange={(e) => setFournisseurNom(e.target.value)} placeholder="Nom fournisseur *" required className={inp} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">N° facture</span>
          <input name="numero" value={numero} onChange={(e) => setNumero(e.target.value)} className={inp} placeholder="N° facture fournisseur" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Date facture</span>
          <input name="date" type="date" value={date} onChange={(e) => { setDate(e.target.value); const f = fournisseurs.find((x) => x.id === fournisseurId); calcEcheance(e.target.value, f?.delaiJours ?? null); }} className={inp} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Échéance (auto selon délai)</span>
          <input name="dateEcheance" type="date" value={echeance} onChange={(e) => setEcheance(e.target.value)} className={inp} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Déjà réglé (USD)</span>
          <input name="montantRegleUSD" type="number" step="0.01" min="0" placeholder="0" className={inp} />
        </label>
      </div>

      <label className="flex items-start gap-2 rounded-lg border bg-muted/30 p-3 text-sm">
        <input name="entrerEnStock" type="checkbox" defaultChecked className="mt-0.5" />
        <span>
          <span className="font-medium">Entrer les articles en stock</span>
          <span className="block text-xs text-muted-foreground">Chaque ligne reliée à un article du catalogue augmente le stock. C’est l’enregistrement de la facture qui alimente le stock (pas la réception du bon de commande).</span>
        </span>
      </label>

      <div className="max-h-[70vh] overflow-auto rounded-lg border">
        <table className="w-full min-w-[52rem] text-sm">
          <thead className="sticky top-0 z-10 bg-muted text-left">
            <tr>
              <th className="px-2 py-2">Article (catalogue)</th>
              <th className="px-2 py-2">Désignation</th>
              <th className="px-2 py-2">Unité</th>
              <th className="px-2 py-2 text-right">Quantité</th>
              <th className="px-2 py-2 text-right">P.U. USD</th>
              <th className="px-2 py-2 text-right">Total</th>
              <th className="px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {lignes.map((l, i) => (
              <tr key={i} className="border-t">
                <td className="px-2 py-1">
                  <select value={l.articleId} onChange={(e) => choisirArticle(i, e.target.value)} className={`${inp} min-w-44`}>
                    <option value="">— libre —</option>
                    {articles.map((a) => <option key={a.id} value={a.id}>{a.designation}</option>)}
                  </select>
                  <input type="hidden" name="ligne_articleId" value={l.articleId} />
                </td>
                <td className="px-2 py-1"><input name="ligne_designation" value={l.designation} onChange={(e) => maj(i, { designation: e.target.value })} className={`${inp} w-full min-w-40`} placeholder="Désignation" /></td>
                <td className="px-2 py-1"><input name="ligne_unite" value={l.unite} onChange={(e) => maj(i, { unite: e.target.value })} className={`${inp} w-20`} placeholder="Kg…" /></td>
                <td className="px-2 py-1"><input name="ligne_quantite" value={l.quantite} onChange={(e) => maj(i, { quantite: e.target.value })} type="number" step="0.001" min="0" className={`${inp} w-24 text-right`} /></td>
                <td className="px-2 py-1"><input name="ligne_prix" value={l.prix} onChange={(e) => maj(i, { prix: e.target.value })} type="number" step="0.0001" min="0" className={`${inp} w-24 text-right`} /></td>
                <td className="px-2 py-1 text-right text-muted-foreground">{((Number(l.quantite) || 0) * (Number(l.prix) || 0)).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $</td>
                <td className="px-2 py-1 text-right">
                  <button type="button" onClick={() => setLignes((ls) => ls.filter((_, j) => j !== i))} className="rounded border px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent" title="Retirer">✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={() => setLignes((ls) => [...ls, vide()])} className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">+ Ligne</button>
        <div className="text-right">
          <span className="text-sm text-muted-foreground">Montant total : </span>
          <span className="text-lg font-semibold">{total.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $</span>
        </div>
      </div>

      <button disabled={isPending} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
        {isPending ? "Enregistrement…" : "Enregistrer la facture"}
      </button>
    </form>
  );
}

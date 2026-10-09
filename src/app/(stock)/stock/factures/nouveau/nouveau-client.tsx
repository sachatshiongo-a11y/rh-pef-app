"use client";

import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import { creerFactureAvecLignes, analyserFacturePDF, type AnalyseFacture } from "../actions";
import { estErreur } from "@/lib/action-lisible";
import { CelluleNombre } from "@/components/tableur/cellule-nombre";
import { useLigneSuivante } from "@/components/tableur/ligne-suivante";
import { ZoneTableur } from "@/components/tableur/messages";
import { ecrireSaisieNombre, lireSaisieNombre, MOTIF_HTML_DECIMAL_POSITIF } from "@/lib/nombre";
import { canoniqueVersSaisie, nombreDeSaisie } from "@/lib/saisie-nombre-stock";
import { empecherEnvoiParEntree } from "@/lib/entree-sans-envoi";
import { jourCourantKinshasaISO } from "@/lib/heure-kinshasa";
import { ChoixRecherche } from "@/components/choix-recherche";
import { optionsArticles, optionsFournisseurs } from "@/lib/recherche-options";
import { formaterMontantFacture, libelleAutreDevise } from "@/lib/facture-devise";
import { formaterNombre } from "@/lib/montant";

/** Texte de ligne → valeur de case (« 12.500 » reçu du serveur ou du PDF → 12,5 affiché). */
const nombreOuNull = (s: string) => { const l = lireSaisieNombre(s); return l.ok ? l.valeur : null; };
/**
 * Valeur de case → texte de ligne : écriture à la FRANÇAISE (« 2,5 »), relisible par `nombreOuNull`
 * et par le serveur (champs cachés ligne_quantite / ligne_prix lus par `decSaisi`). Les montants se
 * calculent par `nombreDeSaisie`, jamais par `Number()` (qui lirait « 2,5 » comme NaN). Tout ce que
 * le PROGRAMME écrit dans une ligne (PDF analysé, bon de commande, catalogue) passe par
 * `canoniqueVersSaisie`.
 */
const texteDe = (v: number | null) => (v === null ? "" : ecrireSaisieNombre(v));

/**
 * Prix catalogue PROPOSÉS dans chaque devise de facture (2026-10-09 : facture en $ ou en FC) :
 * `prix` en dollars, `prixCDF` en francs — exact dans la devise du prix de référence de l'article
 * (`refDevise`), converti au taux du jour dans l'autre (annoncé « ≈ » sous la case) ; vide sans prix
 * ou sans taux. `prixFC` : « 7 000 FC » si le prix de référence est en francs ; `prixRef` : le prix
 * de référence formaté, dans sa devise.
 */
type Art = { id: string; designation: string; nomCourt?: string | null; code?: string | null; prix: string | null; prixFC?: string | null; prixCDF?: string | null; refDevise?: Devise | null; prixRef?: string | null; unite: string | null };
type Devise = "USD" | "CDF";
type Four = { id: string; nom: string; delaiJours: number | null };
type BonLigne = { articleId: string | null; designation: string; unite: string | null; quantite: string; prix: string };
type Bon = { id: string; numero: string; fournisseurId: string | null; fournisseurNom: string; delaiJours: number | null; lignes: BonLigne[] };
type Ligne = { articleId: string; designation: string; unite: string; quantite: string; prix: string };

const inp = "rounded border border-input bg-background px-2 py-1 text-sm";
const vide = (): Ligne => ({ articleId: "", designation: "", unite: "", quantite: "", prix: "" });

export function NouvelleFactureForm({ articles, fournisseurs, bons, bcInitial, estDirection = true, taux = null }: { articles: Art[]; fournisseurs: Four[]; bons: Bon[]; bcInitial: string | null; estDirection?: boolean; taux?: number | null }) {
  // Une liste d'options par écran, partagée par toutes les lignes (recherche par désignation, nom court, code).
  const optionsArt = useMemo(() => optionsArticles(articles), [articles]);
  const optionsFour = useMemo(() => optionsFournisseurs(fournisseurs), [fournisseurs]);
  const bon0 = bons.find((b) => b.id === bcInitial) ?? null;
  // Devise de LA facture (2026-10-09) : ses prix de ligne, son total et son reste sont dans cette devise.
  const [devise, setDevise] = useState<Devise>("USD");
  const [noteDevise, setNoteDevise] = useState<string | null>(null);
  /** Prix catalogue proposé pour un article dans une devise (texte de saisie), "" sans prix. */
  const prixPropose = (articleId: string | null, d: Devise) => {
    const a = articleId ? articles.find((x) => x.id === articleId) : null;
    return canoniqueVersSaisie((d === "USD" ? a?.prix : a?.prixCDF) ?? "");
  };
  // Un bon de commande est en dollars : en francs, ses prix ne sont PAS repris (jamais convertis en
  // silence) — le prix catalogue en francs de l'article est proposé à la place.
  const lignesDeBon = (b: Bon | null, d: Devise = devise): Ligne[] =>
    b && b.lignes.length ? b.lignes.map((l) => ({ articleId: l.articleId ?? "", designation: l.designation, unite: l.unite ?? "", quantite: canoniqueVersSaisie(l.quantite), prix: d === "USD" ? canoniqueVersSaisie(l.prix) : prixPropose(l.articleId, "CDF") })) : [vide(), vide(), vide()];

  const [erreur, setErreur] = useState<string | null>(null);
  const [doublon, setDoublon] = useState<string | null>(null);
  const [isPending, start] = useTransition();
  const [bonId, setBonId] = useState(bon0?.id ?? "");
  const [fournisseurId, setFournisseurId] = useState(bon0?.fournisseurId ?? "");
  const [fournisseurNom, setFournisseurNom] = useState(bon0?.fournisseurNom ?? "");
  const [numero, setNumero] = useState("");
  const [date, setDate] = useState(jourCourantKinshasaISO());
  const [echeance, setEcheance] = useState("");
  const [lignes, setLignes] = useState<Ligne[]>(lignesDeBon(bon0, "USD"));
  /**
   * Changer la devise de la facture : un prix saisi dans l'autre devise n'est JAMAIS réinterprété
   * (12 $ ne deviennent pas 12 FC). Ligne reliée au catalogue : son prix catalogue dans la nouvelle
   * devise est proposé ; ligne libre : son prix est vidé, à ressaisir. L'écran le dit.
   */
  const changerDevise = (d: Devise) => {
    if (d === devise) return;
    const libres = lignes.filter((l) => !l.articleId && l.prix.trim() !== "").length;
    setDevise(d);
    setLignes((ls) => ls.map((l) => ({ ...l, prix: l.articleId ? prixPropose(l.articleId, d) : "" })));
    setNoteDevise(`Facture en ${d === "USD" ? "dollars ($)" : "francs (FC)"} : prix catalogue proposés dans cette devise${libres > 0 ? ` ; ${libres} prix saisi(s) à la main effacé(s), à ressaisir en ${d === "USD" ? "dollars" : "francs"}` : ""}.`);
  };
  const pdfRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
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
        // Document libellé en francs : la facture passe en francs, montants tels que lus (jamais convertis).
        // La devise ne suit le document QUE si ses montants remplacent les lignes : un PDF illisible
        // (rien d'extrait) ne doit jamais faire passer en dollars des prix saisis en francs (relecture).
        if (r.lignes.length > 0 || r.montant != null) {
          setDevise(r.devise);
          setNoteDevise(r.devise === "CDF" ? "Document lu en francs : facture en francs (FC), montants tels que lus — à vérifier." : null);
        }
        if (r.lignes.length > 0) {
          setLignes(r.lignes.map((l) => ({ articleId: l.articleId ?? "", designation: l.designation, unite: l.unite ?? "", quantite: canoniqueVersSaisie(l.quantite), prix: canoniqueVersSaisie(l.prixUnitaireUSD) })));
        } else if (r.montant != null) {
          setLignes([{ articleId: "", designation: "Facture (voir PDF joint)", unite: "", quantite: "1", prix: canoniqueVersSaisie(r.montant) }]);
        }
        // Fournisseur : proche existant → on l'associe ; sinon on prépare la création automatique.
        if (r.match) { setFournisseurId(r.match.id); setFournisseurNom(r.match.nom); setCoord(null); }
        else if (r.fournisseur.nom) { setFournisseurId(""); setFournisseurNom(r.fournisseur.nom); setCoord(r.fournisseur); }
      })
      .catch((e) => setErreur(e instanceof Error ? e.message : "Lecture du PDF échouée."))
      .finally(() => setAnalysing(false));
  };

  const maj = (i: number, patch: Partial<Ligne>) => setLignes((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const ajouterLigne = useCallback(() => setLignes((ls) => [...ls, vide()]), []);
  const { racine, onEntreeDerniereLigne } = useLigneSuivante(lignes.length, ajouterLigne);
  const choisirArticle = (i: number, articleId: string) => {
    const a = articles.find((x) => x.id === articleId);
    maj(i, { articleId, designation: a?.designation ?? "", unite: a?.unite ?? "", prix: prixPropose(articleId, devise) });
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
      if (b.lignes.length) setLignes(lignesDeBon(b, devise));
      calcEcheance(date, b.delaiJours);
    }
  };

  const choisirFournisseur = (id: string) => {
    setFournisseurId(id);
    const f = fournisseurs.find((x) => x.id === id);
    if (f) { setFournisseurNom(f.nom); calcEcheance(date, f.delaiJours); }
  };

  const total = lignes.reduce((t, l) => t + nombreDeSaisie(l.quantite) * nombreDeSaisie(l.prix), 0);
  // En francs : même arrondi que le serveur (prix au centime de franc, total de ligne au centime).
  const totalFC = Math.round(lignes.reduce((t, l) => t + Math.round(nombreDeSaisie(l.quantite) * (Math.round(nombreDeSaisie(l.prix) * 100) / 100) * 100) / 100, 0) * 100) / 100;

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

  // « Enregistrer quand même » n'est PAS un bouton d'envoi : il ne peut donc jamais être le bouton
  // par défaut du formulaire, ni recevoir un envoi implicite (Entrée dans un champ). Seul un clic
  // dessus force l'enregistrement malgré le doublon possible.
  const enregistrerQuandMeme = () => {
    const f = formRef.current;
    if (!f || !f.reportValidity()) return;
    const fd = new FormData(f);
    fd.set("forcerDoublons", "1");
    submit(fd);
  };

  return (
    // Entrée n'envoie jamais la facture : seul un clic sur un bouton l'enregistre.
    <form ref={formRef} action={submit} onKeyDown={empecherEnvoiParEntree} className="space-y-4">
      {erreur && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erreur}</p>}
      {doublon && (
        <div className="rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <p className="font-semibold">⚠ Achat peut-être déjà saisi</p>
          <p className="mt-1">{doublon}</p>
          <button type="button" onClick={enregistrerQuandMeme} disabled={isPending} className="mt-2 rounded-md border border-amber-500 bg-amber-100 px-3 py-1.5 text-xs font-semibold hover:bg-amber-200 disabled:opacity-50">
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
            <p>Extrait : {analyse.montant != null ? `${analyse.montant} ${analyse.devise === "CDF" ? "FC" : "$"}` : "montant ?"} · {analyse.date ?? "date ?"}{analyse.numero ? ` · n° ${analyse.numero}` : ""} — <span className="font-medium">à vérifier</span> (le PDF joint reste la source de vérité).</p>
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

      <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm">
        <span className="font-medium">Devise de la facture</span>
        <div role="group" aria-label="Devise de la facture" className="inline-flex overflow-hidden rounded-md border">
          <button type="button" onClick={() => changerDevise("USD")} aria-pressed={devise === "USD"} className={`px-3 py-1.5 ${devise === "USD" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>Dollars ($)</button>
          <button type="button" onClick={() => changerDevise("CDF")} aria-pressed={devise === "CDF"} className={`px-3 py-1.5 ${devise === "CDF" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>Francs (FC)</button>
        </div>
        <input type="hidden" name="devise" value={devise} />
        <span className="text-xs text-muted-foreground">
          {devise === "CDF"
            ? <>Prix, total et reste à payer en francs, sans conversion. {taux ? <>L&apos;entrée en stock est valorisée en dollars au taux du jour (1 $ = {formaterNombre(taux)} FC).</> : <span className="text-destructive">Taux du jour non défini (Paramètres) : l&apos;entrée en stock sera refusée.</span>}</>
            : "Prix, total et reste à payer en dollars."}
        </span>
        {noteDevise && <p className="w-full text-xs text-sky-800">{noteDevise}</p>}
      </div>

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
          <ChoixRecherche options={optionsFour} value={fournisseurId} vide="— catalogue —" onChange={choisirFournisseur} aria-label="Fournisseur (catalogue)" className={inp} />
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
        {/* Un montant déjà réglé est un paiement : Direction seulement (ailleurs, il se demande depuis la fiche). */}
        {estDirection && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">Déjà réglé ({devise === "USD" ? "$" : "FC"})</span>
            <input name="montantRegle" type="text" inputMode="decimal" pattern={MOTIF_HTML_DECIMAL_POSITIF} title="Montant, ex. 12,50" placeholder="0" className={inp} />
          </label>
        )}
      </div>

      <label className="flex items-start gap-2 rounded-lg border bg-muted/30 p-3 text-sm">
        <input name="entrerEnStock" type="checkbox" defaultChecked className="mt-0.5" />
        <span>
          <span className="font-medium">Entrer les articles en stock</span>
          <span className="block text-xs text-muted-foreground">Chaque ligne reliée à un article du catalogue augmente le stock. C’est l’enregistrement de la facture qui alimente le stock (pas la réception du bon de commande).</span>
        </span>
      </label>

      <ZoneTableur>
      <div className="overflow-x-auto rounded-lg border">
        {/* Tableur : Entrée descend (et ajoute une ligne en bas) sans envoyer la facture ; Tab reste
            celui du navigateur, pour passer aussi par l'article, la désignation et l'unité. */}
        <table ref={racine} data-tableur="" data-tableur-tab="natif" className="w-full min-w-[52rem] text-sm">
          <thead className="bg-muted text-left">
            <tr>
              <th className="px-2 py-2">Article (catalogue)</th>
              <th className="px-2 py-2">Désignation</th>
              <th className="px-2 py-2">Unité</th>
              <th className="px-2 py-2 text-right">Quantité</th>
              <th className="px-2 py-2 text-right">P.U. {devise === "USD" ? "USD" : "FC"}</th>
              <th className="px-2 py-2 text-right">Total</th>
              <th className="px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {lignes.map((l, i) => (
              <tr key={i} className="border-t">
                <td className="px-2 py-1">
                  <ChoixRecherche options={optionsArt} colonne="article" value={l.articleId} vide="— libre —" onChange={(id) => choisirArticle(i, id)} aria-label={`Article, ligne ${i + 1}`} className={`${inp} w-full min-w-44`} />
                  <input type="hidden" name="ligne_articleId" value={l.articleId} />
                </td>
                <td className="px-2 py-1"><input name="ligne_designation" value={l.designation} onChange={(e) => maj(i, { designation: e.target.value })} className={`${inp} w-full min-w-40`} placeholder="Désignation" /></td>
                <td className="px-2 py-1"><input name="ligne_unite" value={l.unite} onChange={(e) => maj(i, { unite: e.target.value })} className={`${inp} w-20`} placeholder="Kg…" /></td>
                <td className="px-2 py-1">
                  <input type="hidden" name="ligne_quantite" value={l.quantite} />
                  <CelluleNombre ligne={String(i)} col={0} valeur={nombreOuNull(l.quantite)} onEnregistrer={(v) => maj(i, { quantite: texteDe(v) })}
                    onEntreeDerniereLigne={onEntreeDerniereLigne} min={0} quantite className={`${inp} w-24 text-right`} aria-label={`Quantité, ligne ${i + 1}`} />
                </td>
                <td className="px-2 py-1">
                  <input type="hidden" name="ligne_prix" value={l.prix} />
                  <CelluleNombre ligne={String(i)} col={1} valeur={nombreOuNull(l.prix)} onEnregistrer={(v) => maj(i, { prix: texteDe(v) })}
                    onEntreeDerniereLigne={onEntreeDerniereLigne} min={0} className={`${inp} w-24 text-right`} aria-label={`Prix unitaire, ligne ${i + 1}`} />
                  {(() => {
                    // Prix de référence dans l'AUTRE devise que la facture : le prix proposé est une conversion au taux du jour, annoncée.
                    const a = l.articleId ? articles.find((x) => x.id === l.articleId) : null;
                    const ref = a?.refDevise ?? (a?.prixFC ? "CDF" : a?.prix ? "USD" : null);
                    const libRef = a?.prixRef ?? a?.prixFC ?? null;
                    return a && ref && ref !== devise && libRef ? <span className="block text-[10px] text-muted-foreground" title={`Prix de référence en ${ref === "CDF" ? "francs" : "dollars"} : converti au taux du jour`}>{libRef} ≈</span> : null;
                  })()}
                </td>
                <td className="px-2 py-1 text-right text-muted-foreground">{devise === "USD" ? `${(nombreDeSaisie(l.quantite) * nombreDeSaisie(l.prix)).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $` : formaterMontantFacture(Math.round(nombreDeSaisie(l.quantite) * Math.round(nombreDeSaisie(l.prix) * 100) / 100 * 100) / 100, "CDF")}</td>
                <td className="px-2 py-1 text-right">
                  <button type="button" onClick={() => setLignes((ls) => ls.filter((_, j) => j !== i))} className="rounded border px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent" title="Retirer">✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </ZoneTableur>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={ajouterLigne} className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">+ Ligne</button>
        <div className="text-right">
          <span className="text-sm text-muted-foreground">Montant total : </span>
          <span className="text-lg font-semibold">{devise === "USD" ? `${total.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $` : formaterMontantFacture(totalFC, "CDF")}</span>
          {devise === "CDF" && <span className="block text-xs text-muted-foreground">{libelleAutreDevise(totalFC, "CDF", taux)} au taux du jour (indicatif : la facture reste en francs)</span>}
        </div>
      </div>

      <button type="submit" disabled={isPending} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
        {isPending ? "Enregistrement…" : "Enregistrer la facture"}
      </button>
    </form>
  );
}

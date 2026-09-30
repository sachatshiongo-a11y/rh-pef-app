"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { entreeListeAchat, verifierDoublonsListe } from "./actions";
import { BoutonReinitialiser } from "../_rapport/bouton-reinitialiser";
import { estErreur } from "@/lib/action-lisible";
import { cleAlnum } from "@/lib/texte";
import { CelluleNombre } from "@/components/tableur/cellule-nombre";
import { useLigneSuivante } from "@/components/tableur/ligne-suivante";
import { ZoneTableur } from "@/components/tableur/messages";
import { lireSaisieNombre } from "@/lib/nombre";
import { empecherEnvoiParEntree } from "@/lib/entree-sans-envoi";
import { formaterFC, formaterNombre, formaterUSD } from "@/lib/montant";

type Art = { id: string; designation: string; unite: string | null; domaine: string; prix: string | null };
type Fourn = { id: string; nom: string };
type Devise = "USD" | "CDF";
/** Libellé court d'une devise, tel qu'il s'affiche à côté du montant. */
const COURT: Record<Devise, string> = { USD: "USD", CDF: "FC" };
const inp = "rounded border border-input bg-background px-2 py-1 text-sm";
/** Texte de ligne → valeur de case ; valeur de case → texte à POINT (ce que produisait l'ancien champ
 *  number) : les calculs (quantité × PU) et ce qui part au serveur (champs cachés quantite / montant)
 *  sont inchangés, virgule tapée ou non. */
const nombreOuNull = (s: string) => { const l = lireSaisieNombre(s); return l.ok ? l.valeur : null; };
const texteDe = (v: number | null) => (v === null ? "" : String(v));

// Mise en page d'UNE SEULE arborescence, deux présentations (jamais deux jeux de champs : le
// formulaire enverrait chaque ligne en double). Elle suit la largeur de la LISTE (requête de
// conteneur), pas celle de l'écran : le menu latéral en retire 256 px sur ordinateur.
//  - Liste large (≥ 56 rem) : tableur, UNE rangée par ligne sous un en-tête de colonnes unique.
//  - Sinon (téléphone, tablette) : une carte compacte par ligne, sur 5 pistes :
//      article (3) · montant + devise · ✕   — rangée 1
//      qté × PU · unité · ⋯ (détails)       — rangée 2
//      désignation + domaine (ligne libre), puis fournisseur (détails ouverts) — au besoin
// Montant + bascule de devise (USD / FC) dans UNE colonne de 7,5 rem : la largeur prise est rendue
// par l'article, la désignation et le fournisseur (½ rem chacun) — la rangée garde son minimum de
// 55 rem et tient sous le seuil de 56 rem, donc à 1280 px avec le menu latéral.
const COLONNES = "@4xl:grid-cols-[minmax(8.5rem,1.6fr)_minmax(7.5rem,1.4fr)_4rem_6.5rem_4.5rem_5rem_7.5rem_minmax(6.5rem,1.2fr)_2rem]";
// Carte : qté, « × » et PU cèdent 1¼ rem au montant, qui porte désormais sa devise (44 px) à côté :
// « 1500000 » en gras tient à 375 px (relevé à l'écran).
const PISTES = "grid-cols-[3.5rem_0.75rem_4rem_minmax(0,1fr)_2.75rem]";
// `order` : l'ordre du DOM est celui du tableur (Tab) ; la carte réordonne à l'œil.
const PLACE = {
  article: "order-1 col-span-3 @4xl:order-none @4xl:col-span-1",
  designation: "order-9 col-span-3 @4xl:order-none @4xl:col-span-1",
  unite: "order-7 @4xl:order-none",
  domaine: "order-10 col-span-2 @4xl:order-none @4xl:col-span-1",
  qte: "order-4 @4xl:order-none",
  pu: "order-6 @4xl:order-none",
  montant: "order-2 @4xl:order-none",
  fournisseur: "order-11 col-span-5 @4xl:order-none @4xl:col-span-1",
  retirer: "order-3 @4xl:order-none",
};
// Cibles de 44 px sur la carte ; densité tableur (hauteur naturelle) sur la liste large.
const champ = `${inp} h-11 w-full min-w-0 @4xl:h-auto`;
// Montant : marges intérieures resserrées sur la carte (la devise le suit, collée à droite).
const champMontant = champ.replace("px-2", "pl-1.5 pr-1 @4xl:px-2");

// Lignes contrôlées : article du CATALOGUE (désignation/unité reprises) ou ÉCRITURE LIBRE
// (nouvel article, créé automatiquement au catalogue dans le domaine choisi).
// Le prix unitaire (facultatif) répercute quantité × PU sur le montant.
// Fournisseur FACULTATIF par ligne : liste avec recherche (suggestions des fournisseurs connus) ;
// un nom nouveau crée le fournisseur à l'enregistrement.
// `detail` : carte ouverte sur téléphone (fournisseur) — présentation seulement, jamais envoyé.
// `devise` : devise de LA LIGNE (USD ou CDF), envoyée avec elle. `puCatalogue` : prix du catalogue
// (en USD) d'où vient le PU affiché, tant que la personne ne l'a pas retapé — jamais envoyé.
type Ligne = { articleId: string; designation: string; unite: string; domaine: string; qte: string; pu: string; montant: string; devise: Devise; puCatalogue: string | null; fournNom: string; detail: boolean };
const vide = (devise: Devise): Ligne => ({ articleId: "", designation: "", unite: "", domaine: "NOURRITURE", qte: "", pu: "", montant: "", devise, puCatalogue: null, fournNom: "", detail: false });
const quatreVides = (devise: Devise) => [vide(devise), vide(devise), vide(devise), vide(devise)];

export function ListeAchatForm({ articles, fournisseurs, aujourdhui, taux, estDirection = false }: { articles: Art[]; fournisseurs: Fourn[]; aujourdhui: string; taux: number; estDirection?: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; texte: string } | null>(null);
  // Devise par défaut des NOUVELLES lignes (sélecteur du haut). Aussi tenue par référence : « + Ligne »
  // et Entrée sur la dernière ligne gardent un rappel stable.
  const [deviseDefaut, setDeviseDefaut] = useState<Devise>("USD");
  const deviseDefautRef = useRef<Devise>("USD");
  const [lignes, setLignes] = useState<Ligne[]>(() => quatreVides("USD"));
  // Date de l'achat : aujourd'hui (Kinshasa) par défaut ; jamais dans le futur (contrôlé au serveur).
  const [date, setDate] = useState(aujourdhui);
  // Avertissements de la saisie, rattachés à l'état vérifié : périmés dès que la saisie change.
  const [verif, setVerif] = useState<{ cle: string; liste: string[] }>({ cle: "", liste: [] });
  const [avertissementsEnregistres, setAvertissementsEnregistres] = useState<string[]>([]); // du dernier enregistrement
  const [cle, setCle] = useState(0);
  const reinitialiser = () => { setMsg(null); deviseDefautRef.current = "USD"; setDeviseDefaut("USD"); setLignes(quatreVides("USD")); setDate(aujourdhui); setAvertissementsEnregistres([]); setCle((c) => c + 1); };

  // Nom tapé → fournisseur connu (même clé que le serveur : casse et accents ignorés).
  const fournParCle = useMemo(() => new Map(fournisseurs.map((f) => [cleAlnum(f.nom), f.id])), [fournisseurs]);
  const idFourn = (nom: string) => (nom.trim() ? fournParCle.get(cleAlnum(nom)) ?? "" : "");
  const nouveauxFournisseurs = [...new Set(lignes.map((l) => l.fournNom.trim()).filter((n) => n && !idFourn(n)))];

  // Double saisie : vérifiée PENDANT la saisie (même article, même jour, même quantité déjà entré
  // par facture ou réception ; comptage postérieur). Avertissement seulement — rien n'est bloqué.
  const aVerifier = lignes
    .map((l) => ({ articleId: l.articleId, designation: l.designation.trim(), quantite: Number(l.qte.replace(",", ".")) }))
    .filter((l) => (l.articleId || l.designation) && l.quantite > 0);
  const cleVerif = JSON.stringify([date, aVerifier]);
  useEffect(() => {
    if (aVerifier.length === 0) return;
    let annule = false;
    const t = setTimeout(async () => {
      const r = await verifierDoublonsListe(date, aVerifier);
      if (!annule && !estErreur(r)) setVerif({ cle: cleVerif, liste: r.avertissements });
    }, 500);
    return () => { annule = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `cleVerif` résume date + lignes vérifiées
  }, [cleVerif]);
  const avertissements = verif.cle === cleVerif ? verif.liste : [];

  const majLigne = (i: number, patch: Partial<Ligne>) =>
    setLignes((ls) =>
      ls.map((l, j) => {
        if (j !== i) return l;
        const maj = { ...l, ...patch };
        // PU retapé : il ne vient plus du catalogue (la bascule de devise ne le convertira pas).
        if ("pu" in patch && !("puCatalogue" in patch)) maj.puCatalogue = null;
        // Quantité ou PU modifiés et PU renseigné → montant recalculé (modifiable ensuite à la main).
        if (("qte" in patch || "pu" in patch) && maj.pu !== "") {
          const q = Number(maj.qte.replace(",", "."));
          const pu = Number(maj.pu.replace(",", "."));
          maj.montant = q > 0 && pu > 0 ? String(Math.round(q * pu * 100) / 100) : "";
        }
        return maj;
      })
    );

  // Devise par défaut : vaut pour les lignes AJOUTÉES ensuite, et pour les lignes encore VIERGES
  // (les 4 lignes vides de départ passent donc en FC avec elle — sinon on les croirait en FC alors
  // qu'elles partiraient en USD). Une ligne où quelque chose est saisi garde SA devise : le défaut ne
  // relabellise jamais un montant tapé.
  const vierge = (l: Ligne) => !l.articleId && !l.designation.trim() && !l.unite.trim() && !l.qte && !l.pu && !l.montant && !l.fournNom.trim();
  const changerDeviseDefaut = (d: Devise) => {
    deviseDefautRef.current = d;
    setDeviseDefaut(d);
    setLignes((ls) => ls.map((l) => (vierge(l) ? { ...l, devise: d } : l)));
  };

  // Bascule de devise D'UNE ligne (un appui) : les nombres tapés restent tels quels — ils sont ceux
  // du ticket, seule leur devise change (et un second appui revient exactement en arrière). Seul un
  // PU REPRIS DU CATALOGUE (en USD, pas tapé) est converti au taux du jour, pour ne jamais lire
  // « 1,7 FC » ; il repart du prix du catalogue au retour en USD (aucune dérive d'arrondi). Le
  // montant suit alors la règle quantité × PU.
  const basculerDevise = (i: number) => {
    const l = lignes[i];
    const d: Devise = l.devise === "USD" ? "CDF" : "USD";
    const prix = l.puCatalogue !== null ? Number(l.puCatalogue) : NaN;
    if (taux > 0 && prix > 0) {
      const pu = d === "CDF" ? String(Math.round(prix * taux)) : l.puCatalogue!;
      majLigne(i, { devise: d, pu, puCatalogue: l.puCatalogue });
    } else majLigne(i, { devise: d });
  };

  const choisirArticle = (i: number, articleId: string) => {
    const a = articles.find((x) => x.id === articleId);
    setLignes((ls) =>
      ls.map((l, j) =>
        j !== i
          ? l
          : a
          ? { ...l, articleId, designation: a.designation, unite: a.unite ?? "", domaine: a.domaine, ...(l.devise === "USD" && a.prix ? { pu: a.prix, puCatalogue: a.prix } : {}) }
          : { ...l, articleId: "", designation: "", unite: "" }
      )
    );
  };

  const ajouterLigne = useCallback(() => setLignes((ls) => [...ls, vide(deviseDefautRef.current)]), []);
  const { racine, onEntreeDerniereLigne } = useLigneSuivante<HTMLDivElement>(lignes.length, ajouterLigne);

  // Total : en USD, au taux qu'appliquera l'enregistrement (Config, le même que `taux`), sur les lignes
  // qui seront enregistrées (article ou désignation, quantité > 0, montant > 0). Les francs saisis se
  // lisent À PART : jamais additionnés aux dollars sans conversion. Taux absent : total inconnu (« — »).
  const aMontant = lignes
    .map((l) => ({ l, m: Number(l.montant) }))
    .filter(({ l, m }) => (l.articleId || l.designation.trim()) && Number(l.qte) > 0 && m > 0);
  const saisiUSD = aMontant.filter(({ l }) => l.devise === "USD").reduce((t, { m }) => t + m, 0);
  const saisiFC = aMontant.filter(({ l }) => l.devise === "CDF").reduce((t, { m }) => t + m, 0);
  const aFrancs = aMontant.some(({ l }) => l.devise === "CDF");
  const fcEnUSD = aFrancs && taux > 0 ? saisiFC / taux : null;
  const totalUSD = aFrancs ? (fcEnUSD === null ? null : saisiUSD + fcEnUSD) : saisiUSD;
  const lignesFC = lignes.some((l) => l.devise === "CDF") || deviseDefaut === "CDF";

  const submit = (fd: FormData) => {
    setMsg(null);
    setAvertissementsEnregistres([]);
    startTransition(async () => {
      const r = await entreeListeAchat(fd);
      if (estErreur(r)) { setMsg({ ok: false, texte: r.erreur }); return; }
      setMsg({
        ok: true,
        texte: `Entrées enregistrées : le stock a été mis à jour.${r.crees.length ? ` ${r.crees.length} nouvel(aux) article(s) créé(s) au catalogue : ${r.crees.join(", ")}.` : ""}${r.fournisseursCrees.length ? ` Nouveau(x) fournisseur(s) créé(s) : ${r.fournisseursCrees.join(", ")}.` : ""}`,
      });
      setLignes(quatreVides(deviseDefautRef.current));
      setCle((c) => c + 1);
      // L'achat est enregistré ; ses avertissements restent sous les yeux : à la personne de trancher.
      setAvertissementsEnregistres(r.avertissements);
    });
  };

  return (
    // Entrée n'envoie jamais l'entrée en stock : seul un clic sur « Valider » l'enregistre.
    <form key={cle} action={submit} onKeyDown={empecherEnvoiParEntree} className="space-y-3">
      {msg && (
        <p className={`rounded-md border px-3 py-2 text-sm ${msg.ok ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-destructive/40 bg-destructive/10 text-destructive"}`}>
          {msg.texte}
        </p>
      )}

      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Date de l&apos;achat</span>
          <input type="date" name="date" value={date} max={aujourdhui} required onChange={(e) => setDate(e.target.value)} className={inp} />
        </label>
        {/* Largeur plancher (hors téléphone) : sinon la devise par défaut et le taux l'écrasent à 1280 px. */}
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm sm:min-w-[16rem]">
          <span className="text-muted-foreground">Origine / libellé (optionnel)</span>
          <input name="origine" placeholder="Liste d'achat semaine…" className={inp} />
        </label>
        <div className="text-sm">
          {/* Défaut seulement : chaque ligne porte sa devise (bascule USD / FC à côté de son montant). Rien n'est envoyé d'ici. */}
          <span id="devise-defaut" className="block text-muted-foreground">Devise par défaut des nouvelles lignes</span>
          <div role="group" aria-labelledby="devise-defaut" className="mt-1 inline-flex overflow-hidden rounded-md border">
            <button type="button" aria-pressed={deviseDefaut === "USD"} onClick={() => changerDeviseDefaut("USD")} className={`px-3 py-1.5 ${deviseDefaut === "USD" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>USD</button>
            <button type="button" aria-pressed={deviseDefaut === "CDF"} onClick={() => changerDeviseDefaut("CDF")} className={`px-3 py-1.5 ${deviseDefaut === "CDF" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>CDF (FC)</button>
          </div>
        </div>
        {lignesFC && (taux > 0
          ? <span className="pb-1.5 text-xs text-muted-foreground">Taux : 1 USD = {formaterNombre(taux)} FC (lignes en FC converties automatiquement)</span>
          : <span role="status" className="pb-1.5 text-xs font-medium text-amber-800">Taux CDF/USD non défini (Paramètres) : une ligne en FC avec un montant sera refusée.</span>)}
      </div>

      {/* Tableur : Entrée descend à la même colonne (et ajoute une ligne en bas) sans envoyer le formulaire ;
          Tab reste celui du navigateur, pour passer aussi par l'article, l'unité, le fournisseur… */}
      <ZoneTableur>
        <div className="@container">
          <div ref={racine} data-tableur="" data-tableur-tab="natif" className="space-y-2 @4xl:space-y-0">
            {/* En-têtes de colonnes : UNE fois, liste large seulement (la carte étiquette ses champs par leur texte indicatif). */}
            <div className={`sticky top-0 z-10 hidden gap-1.5 rounded-md bg-muted px-0 py-1.5 text-xs font-medium text-muted-foreground @4xl:grid ${COLONNES}`}>
              <span className="pl-2">Article (catalogue)</span>
              <span className="pl-2">Désignation (libre si nouveau)</span>
              <span className="pl-2">Unité</span>
              <span className="pl-2">Domaine</span>
              <span className="pr-2 text-right">Qté</span>
              <span className="pr-2 text-right">PU</span>
              <span className="pr-12 text-right">Montant</span>
              <span className="pl-2">Fournisseur (facultatif)</span>
              <span className="sr-only">Retirer</span>
            </div>
            {lignes.map((l, i) => {
              const libre = !l.articleId;
              // Téléphone : la désignation et le domaine ne s'affichent que s'il faut les saisir (ligne libre : pour
              // un article du catalogue, ils ne font que recopier l'article) ; le fournisseur, seulement carte
              // ouverte. Sur la liste large : tout.
              const montreDesignation = libre ? "" : "hidden @4xl:block";
              const montreDomaine = montreDesignation;
              const montreFournisseur = l.detail ? "" : "hidden @4xl:block";
              return (
                <div key={i} data-ligne-achat className={`grid gap-1.5 rounded-lg border p-2 ${PISTES} ${COLONNES} @4xl:items-center @4xl:rounded-none @4xl:border-0 @4xl:border-t @4xl:p-0 @4xl:py-0.5`}>
                  <select name="articleId" value={l.articleId} onChange={(e) => choisirArticle(i, e.target.value)} aria-label={`Article, ligne ${i + 1}`} className={`${champ} ${PLACE.article}`}>
                    <option value="">— libre —</option>
                    {articles.map((a) => <option key={a.id} value={a.id}>{a.designation}</option>)}
                  </select>
                  <input name="designation" placeholder="Désignation" aria-label={`Désignation, ligne ${i + 1}`} value={l.designation} onChange={(e) => majLigne(i, { designation: e.target.value })} readOnly={!libre} className={`${champ} ${PLACE.designation} ${montreDesignation} ${!libre ? "text-muted-foreground" : ""}`} />
                  <input name="unite" placeholder="Kg…" aria-label={`Unité, ligne ${i + 1}`} value={l.unite} onChange={(e) => majLigne(i, { unite: e.target.value })} readOnly={!libre} className={`${champ} ${PLACE.unite} ${!libre ? "text-muted-foreground" : ""}`} />
                  {/* Domaine du NOUVEL article (création automatique au catalogue) — figé si article existant. */}
                  <select name="domaine" value={l.domaine} onChange={(e) => majLigne(i, { domaine: e.target.value })} disabled={!libre} aria-label={`Domaine, ligne ${i + 1}`} className={`${champ} ${PLACE.domaine} ${montreDomaine} disabled:opacity-60`}>
                    <option value="NOURRITURE">Nourriture</option>
                    <option value="BOISSON">Boisson</option>
                    <option value="AUTRE">Autre</option>
                  </select>
                  {!libre && <input type="hidden" name="domaine" value={l.domaine} />}
                  {/* Quantité, PU, montant : cases du tableur (sans flèches, Entrée descend). Ce qui part au serveur
                      est le champ caché à point ; le PU, FACULTATIF, n'est jamais envoyé — il sert à remplir le montant. */}
                  <input type="hidden" name="quantite" value={l.qte} />
                  <CelluleNombre ligne={String(i)} col={0} valeur={nombreOuNull(l.qte)} onEnregistrer={(v) => majLigne(i, { qte: texteDe(v) })}
                    onEntreeDerniereLigne={onEntreeDerniereLigne} min={0} quantite placeholder="Qté" className={`${champ} ${PLACE.qte} text-right`} aria-label={`Quantité, ligne ${i + 1}`} />
                  <span aria-hidden className="order-5 text-center text-muted-foreground @4xl:hidden">×</span>
                  <CelluleNombre ligne={String(i)} col={1} valeur={nombreOuNull(l.pu)} onEnregistrer={(v) => majLigne(i, { pu: texteDe(v) })}
                    onEntreeDerniereLigne={onEntreeDerniereLigne} min={0} placeholder="PU" title="Prix unitaire (facultatif) — remplit le montant : quantité × PU"
                    className={`${champ} ${PLACE.pu} text-right`} aria-label={`Prix unitaire ${COURT[l.devise]}, ligne ${i + 1}`} />
                  <input type="hidden" name="montant" value={l.montant} />
                  {/* Montant + devise DE LA LIGNE, collés : « 28000 | FC ». Un appui sur la devise la bascule
                      (USD ⇄ FC) ; elle part avec la ligne (champ `devise` répété, dans l'ordre des lignes). */}
                  <div className={`${PLACE.montant} flex min-w-0`}>
                    <CelluleNombre ligne={String(i)} col={2} valeur={nombreOuNull(l.montant)} onEnregistrer={(v) => majLigne(i, { montant: texteDe(v) })}
                      onEntreeDerniereLigne={onEntreeDerniereLigne} min={0} placeholder="Montant"
                      title={`Montant payé pour la ligne (${COURT[l.devise]})${l.devise === "CDF" && Number(l.montant) > 0 && taux > 0 ? ` ≈ ${formaterUSD(Number(l.montant) / taux)}` : ""}`}
                      className={`${champMontant} rounded-r-none text-right font-semibold placeholder:font-normal @4xl:font-normal`} aria-label={`Montant ${COURT[l.devise]}, ligne ${i + 1}`} />
                    <input type="hidden" name="devise" value={l.devise} />
                    <button type="button" data-devise-ligne={l.devise} onClick={() => basculerDevise(i)}
                      aria-label={`Devise de la ligne ${i + 1} : ${l.devise === "USD" ? "dollars (USD)" : "francs (FC)"} — changer en ${l.devise === "USD" ? "francs (FC)" : "dollars (USD)"}`}
                      title={l.devise === "USD" ? "Payé en dollars — appuyer pour passer en francs (FC)" : "Payé en francs — appuyer pour passer en dollars (USD)"}
                      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-r border border-l-0 border-input text-xs font-bold @4xl:h-auto @4xl:w-10 @4xl:self-stretch ${l.devise === "CDF" ? "bg-amber-50 text-amber-900 hover:bg-amber-100" : "bg-muted text-foreground hover:bg-accent"}`}>
                      {COURT[l.devise]}
                    </button>
                  </div>
                  {/* Fournisseur DE CETTE LIGNE : suggestions des fournisseurs connus ; un nom nouveau est créé. */}
                  <input name="fournisseurNom" list="fournisseurs-connus" autoComplete="off" placeholder="Fournisseur" aria-label={`Fournisseur de la ligne ${i + 1}`} value={l.fournNom} onChange={(e) => majLigne(i, { fournNom: e.target.value })} className={`${champ} ${PLACE.fournisseur} ${montreFournisseur}`} />
                  <input type="hidden" name="fournisseurId" value={idFourn(l.fournNom)} />
                  {/* Téléphone seulement : déplie le fournisseur de la carte. */}
                  <button type="button" onClick={() => majLigne(i, { detail: !l.detail })} aria-expanded={l.detail}
                    aria-label={`Fournisseur et détails, ligne ${i + 1}${l.fournNom.trim() ? ` (${l.fournNom.trim()})` : ""}`}
                    className={`order-8 flex h-11 w-11 items-center justify-center rounded-md border text-base @4xl:hidden ${l.fournNom.trim() ? "border-primary text-primary" : "text-muted-foreground"} ${l.detail ? "bg-accent" : ""}`}>⋯</button>
                  <button type="button" onClick={() => setLignes((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : ls.map((x, j) => (j === i ? vide(deviseDefautRef.current) : x))))} aria-label={`Retirer la ligne ${i + 1}`} title="Retirer la ligne"
                    className={`${PLACE.retirer} flex h-11 w-11 items-center justify-center rounded-md border text-sm text-muted-foreground hover:bg-destructive/10 hover:text-destructive @4xl:h-8 @4xl:w-8`}>✕</button>
                </div>
              );
            })}
          </div>
        </div>
      </ZoneTableur>

      {aMontant.length > 0 && (
        <p data-total-achat aria-live="polite" className="flex flex-wrap items-baseline justify-end gap-x-3 gap-y-0.5 text-sm tabular-nums">
          <span>Total en USD : <b>{totalUSD === null ? "—" : formaterUSD(totalUSD)}</b></span>
          {aFrancs && (
            <>
              <span className="text-muted-foreground">dont en USD : {formaterUSD(saisiUSD)}</span>
              <span className="text-muted-foreground">en FC : <b className="text-foreground">{formaterFC(saisiFC)}</b> {fcEnUSD === null ? "(taux non défini : non converti)" : `≈ ${formaterUSD(fcEnUSD)}`}</span>
            </>
          )}
        </p>
      )}

      <datalist id="fournisseurs-connus">
        {fournisseurs.map((f) => <option key={f.id} value={f.nom} />)}
      </datalist>
      {nouveauxFournisseurs.length > 0 && (
        <p className="text-xs text-muted-foreground">Nouveau(x) fournisseur(s), créé(s) à l&apos;enregistrement : <b>{nouveauxFournisseurs.join(", ")}</b>.</p>
      )}
      {[
        { titre: "Enregistré — à vérifier :", liste: avertissementsEnregistres },
        { titre: "À vérifier (l'enregistrement n'est pas bloqué) :", liste: avertissements },
      ].map((b) => b.liste.length > 0 && (
        <div key={b.titre} role="status" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <p className="font-medium">{b.titre}</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {b.liste.map((a) => <li key={a}>{a}</li>)}
          </ul>
        </div>
      ))}

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={ajouterLigne} className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">+ Ligne</button>
        <button disabled={isPending} className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
          {isPending ? "Enregistrement…" : "Valider l'entrée en stock"}
        </button>
        <BoutonReinitialiser estDirection={estDirection} onClick={reinitialiser} />
      </div>
      <p className="text-xs text-muted-foreground">Article du catalogue OU désignation libre : un nouvel article est <b>créé automatiquement au catalogue</b> (domaine choisi, unité et prix de cet achat comme référence) — une désignation identique retrouve l&apos;article existant. Prix unitaire et montant sont facultatifs — le PU remplit le montant (quantité × PU), ajustable. Chaque ligne a sa devise (USD ou FC, à côté du montant) ; une ligne en FC est convertie en USD au taux courant (nourrit l&apos;évolution du prix d&apos;achat).</p>
    </form>
  );
}

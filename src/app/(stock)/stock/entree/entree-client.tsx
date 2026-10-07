"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { entreeListeAchat, verifierDoublonsListe } from "./actions";
import { BoutonReinitialiser } from "../_rapport/bouton-reinitialiser";
import { VueTelephone } from "./entree-telephone";
import { useBrouillonListe } from "./use-brouillon";
import { estErreur } from "@/lib/action-lisible";
import { cleAlnum } from "@/lib/texte";
import { CelluleNombre } from "@/components/tableur/cellule-nombre";
import { useLigneSuivante } from "@/components/tableur/ligne-suivante";
import { ZoneTableur } from "@/components/tableur/messages";
import { ecrireSaisieNombre, lireSaisieNombre } from "@/lib/nombre";
import { nombreDeSaisie } from "@/lib/saisie-nombre-stock";
import { empecherEnvoiParEntree } from "@/lib/entree-sans-envoi";
import { formaterFC, formaterNombre, formaterUSD } from "@/lib/montant";
import { ChoixRecherche } from "@/components/choix-recherche";
import { optionsArticles } from "@/lib/recherche-options";
import {
  aEnregistrer, avecArticle, avecChangement, avecDevise, construireFormData, indexFournisseurs, quatreVides, sansArticleDisparu, vide, vierge,
  type Art, type Brouillon, type Devise, type Fourn, type Ligne,
} from "@/lib/liste-achat-saisie";

/** Libellé court d'une devise, tel qu'il s'affiche à côté du montant. */
const COURT: Record<Devise, string> = { USD: "USD", CDF: "FC" };
const inp = "rounded border border-input bg-background px-2 py-1 text-sm";
/** Texte de ligne → valeur de case ; valeur de case → texte à la FRANÇAISE (« 2,5 ») : relu par
 *  `nombreDeSaisie` pour les calculs (quantité × PU) et par `decSaisi` au serveur (champs
 *  quantite / montant). Jamais `Number()` sur un texte de ligne : « 2,5 » y est illisible. */
const nombreOuNull = (s: string) => { const l = lireSaisieNombre(s); return l.ok ? l.valeur : null; };
const texteDe = (v: number | null) => (v === null ? "" : ecrireSaisieNombre(v));

// DEUX présentations d'UNE SEULE liste d'état (`lignes`), choisies par la largeur de la LISTE (requête de
// conteneur), pas celle de l'écran : le menu latéral en retire 256 px sur ordinateur.
//  - Liste large (≥ 56 rem) : tableur, UNE rangée par ligne sous un en-tête de colonnes unique.
//  - Sinon (téléphone, tablette) : la vue de `entree-telephone.tsx` — récapitulatif + panneau plein écran.
// Ce qui part au serveur n'est PAS relu dans le DOM : `construireFormData` le construit depuis l'état,
// pour les deux vues (jamais deux jeux de champs qui divergent ni de ligne envoyée en double).
// Montant + bascule de devise (USD / FC) dans UNE colonne de 7,5 rem : la largeur prise est rendue
// par l'article, la désignation et le fournisseur (½ rem chacun) — la rangée garde son minimum de
// 55 rem et tient sous le seuil de 56 rem, donc à 1280 px avec le menu latéral.
const COLONNES = "@4xl:grid-cols-[minmax(8.5rem,1.6fr)_minmax(7.5rem,1.4fr)_4rem_6.5rem_4.5rem_5rem_7.5rem_minmax(6.5rem,1.2fr)_2rem]";
// Densité tableur (hauteur naturelle).
const champ = `${inp} w-full min-w-0`;

export function ListeAchatForm({ articles, fournisseurs, aujourdhui, taux, estDirection = false, compteId }: { articles: Art[]; fournisseurs: Fourn[]; aujourdhui: string; taux: number; estDirection?: boolean; compteId?: string }) {
  const [isPending, startTransition] = useTransition();
  // UNE liste d'options pour toutes les lignes : on y cherche par désignation, nom court ou code.
  const optionsArt = useMemo(() => optionsArticles(articles), [articles]);
  const [msg, setMsg] = useState<{ ok: boolean; texte: string } | null>(null);
  const refMsg = useRef<HTMLParagraphElement>(null);
  // Devise par défaut des NOUVELLES lignes (sélecteur du haut). Aussi tenue par référence : « + Ligne »
  // et Entrée sur la dernière ligne gardent un rappel stable.
  const [deviseDefaut, setDeviseDefaut] = useState<Devise>("USD");
  const deviseDefautRef = useRef<Devise>("USD");
  const [lignes, setLignes] = useState<Ligne[]>(() => quatreVides("USD"));
  // Date de l'achat : aujourd'hui (Kinshasa) par défaut ; jamais dans le futur (contrôlé au serveur).
  const [date, setDate] = useState(aujourdhui);
  // La date n'entre dans le brouillon que si la personne l'a CHANGÉE : « aujourd'hui » d'hier ne doit pas être reprise un autre jour.
  const [dateChangee, setDateChangee] = useState(false);
  const choisirDate = (d: string) => { setDate(d); setDateChangee(true); };
  const [origine, setOrigine] = useState("");
  // Avertissements de la saisie, rattachés à l'état vérifié : périmés dès que la saisie change.
  const [verif, setVerif] = useState<{ cle: string; liste: string[] }>({ cle: "", liste: [] });
  const [avertissementsEnregistres, setAvertissementsEnregistres] = useState<string[]>([]); // du dernier enregistrement
  const [cle, setCle] = useState(0);
  const reinitialiser = () => { setMsg(null); deviseDefautRef.current = "USD"; setDeviseDefaut("USD"); setLignes(quatreVides("USD")); setDate(aujourdhui); setDateChangee(false); setOrigine(""); setAvertissementsEnregistres([]); setCle((c) => c + 1); };

  // Nom tapé → fournisseur connu (même clé que le serveur : casse et accents ignorés).
  const fournParCle = useMemo(() => indexFournisseurs(fournisseurs), [fournisseurs]);
  const idFourn = useCallback((nom: string) => (nom.trim() ? fournParCle.get(cleAlnum(nom)) ?? "" : ""), [fournParCle]);
  const nouveauxFournisseurs = [...new Set(lignes.map((l) => l.fournNom.trim()).filter((n) => n && !idFourn(n)))];

  // Double saisie : vérifiée PENDANT la saisie (même article, même jour, même quantité déjà entré
  // par facture ou réception ; comptage postérieur). Avertissement seulement — rien n'est bloqué.
  const aVerifier = lignes
    .map((l) => ({ articleId: l.articleId, designation: l.designation.trim(), quantite: nombreDeSaisie(l.qte) }))
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

  const majLigne = (i: number, patch: Partial<Ligne>) => setLignes((ls) => ls.map((l, j) => (j === i ? avecChangement(l, patch) : l)));

  // Devise par défaut : vaut pour les lignes AJOUTÉES ensuite, et pour les lignes encore VIERGES
  // (les 4 lignes vides de départ passent donc en FC avec elle — sinon on les croirait en FC alors
  // qu'elles partiraient en USD). Une ligne où quelque chose est saisi garde SA devise : le défaut ne
  // relabellise jamais un montant tapé.
  const changerDeviseDefaut = (d: Devise) => {
    deviseDefautRef.current = d;
    setDeviseDefaut(d);
    setLignes((ls) => ls.map((l) => (vierge(l) ? { ...l, devise: d } : l)));
  };

  // Bascule de devise D'UNE ligne (un appui) : règle de `avecDevise` (les nombres tapés restent tels quels,
  // seul un PU repris du catalogue est converti au taux).
  const basculerDevise = (i: number) => setLignes((ls) => ls.map((x, j) => (j === i ? avecDevise(x, x.devise === "USD" ? "CDF" : "USD", taux) : x)));

  const choisirArticle = (i: number, articleId: string) => {
    const a = articles.find((x) => x.id === articleId);
    setLignes((ls) => ls.map((l, j) => (j === i ? avecArticle(l, a, taux) : l)));
  };

  const ajouterLigne = useCallback(() => setLignes((ls) => [...ls, vide(deviseDefautRef.current)]), []);
  const { racine, onEntreeDerniereLigne } = useLigneSuivante<HTMLDivElement>(lignes.length, ajouterLigne);

  // Brouillon local (téléphone) : repris tel quel si la liste est encore vide, sinon AJOUTÉ à ce qui est déjà saisi.
  const reprendreBrouillon = useCallback((b: Brouillon) => {
    // Un article disparu du catalogue depuis devient une ligne libre (la désignation est gardée).
    const reprises = b.lignes.map((l) => sansArticleDisparu(l, (id) => articles.some((a) => a.id === id)));
    setLignes((ls) => (ls.every(vierge) ? reprises : [...ls.filter((l) => !vierge(l)), ...reprises]));
    if (lignes.every(vierge)) {
      if (b.date && b.date <= aujourdhui) { setDate(b.date); setDateChangee(true); }
      setOrigine(b.origine);
      deviseDefautRef.current = b.deviseDefaut;
      setDeviseDefaut(b.deviseDefaut);
    }
  }, [lignes, aujourdhui, articles]);
  const brouillon = useBrouillonListe({ compteId, lignes, date: dateChangee ? date : "", origine, deviseDefaut, appliquer: reprendreBrouillon });

  // Total : en USD, au taux qu'appliquera l'enregistrement (Config, le même que `taux`), sur les lignes
  // qui seront enregistrées (article ou désignation, quantité > 0, montant > 0). Les francs saisis se
  // lisent À PART : jamais additionnés aux dollars sans conversion. Taux absent : total inconnu (« — »).
  const aMontant = lignes
    .map((l) => ({ l, m: nombreDeSaisie(l.montant) }))
    .filter(({ l, m }) => aEnregistrer(l) && m > 0);
  const saisiUSD = aMontant.filter(({ l }) => l.devise === "USD").reduce((t, { m }) => t + m, 0);
  const saisiFC = aMontant.filter(({ l }) => l.devise === "CDF").reduce((t, { m }) => t + m, 0);
  const aFrancs = aMontant.some(({ l }) => l.devise === "CDF");
  const fcEnUSD = aFrancs && taux > 0 ? saisiFC / taux : null;
  const totalUSD = aFrancs ? (fcEnUSD === null ? null : saisiUSD + fcEnUSD) : saisiUSD;
  const lignesFC = lignes.some((l) => l.devise === "CDF") || deviseDefaut === "CDF";

  // Un refus ou un résultat s'affiche en haut de la page : on l'amène sous les yeux (téléphone : la barre d'enregistrement est en bas).
  useEffect(() => { if (msg) refMsg.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" }); }, [msg]);

  // L'envoi : construit depuis l'état, le MÊME pour le tableur et la vue téléphone (le formulaire du DOM n'est pas relu).
  const submit = () => {
    setMsg(null);
    setAvertissementsEnregistres([]);
    // Validation maison (le formulaire n'a pas de contrôle natif : un champ masqué par la mise en page bloquerait l'envoi en silence).
    if (!date) { setMsg({ ok: false, texte: "Choisissez la date de l'achat." }); return; }
    if (date > aujourdhui) { setMsg({ ok: false, texte: "La date de l'achat ne peut pas être dans le futur." }); return; }
    const fd = construireFormData({ date, origine, lignes, idFourn });
    startTransition(async () => {
      const r = await entreeListeAchat(fd);
      if (estErreur(r)) { setMsg({ ok: false, texte: r.erreur }); return; }
      setMsg({
        ok: true,
        texte: `Entrées enregistrées : le stock a été mis à jour.${r.crees.length ? ` ${r.crees.length} nouvel(aux) article(s) créé(s) au catalogue : ${r.crees.join(", ")}.` : ""}${r.fournisseursCrees.length ? ` Nouveau(x) fournisseur(s) créé(s) : ${r.fournisseursCrees.join(", ")}.` : ""}`,
      });
      brouillon.apresEnregistrement(); // le brouillon n'a plus lieu d'être, même si son bandeau est encore ouvert
      setLignes(quatreVides(deviseDefautRef.current));
      setOrigine("");
      setCle((c) => c + 1);
      // L'achat est enregistré ; ses avertissements restent sous les yeux : à la personne de trancher.
      setAvertissementsEnregistres(r.avertissements);
    });
  };

  return (
    // Entrée n'envoie jamais l'entrée en stock : seul un clic sur « Valider » l'enregistre.
    <form key={cle} noValidate action={submit} onKeyDown={empecherEnvoiParEntree}>
      {/* Le conteneur : la liste suit SA largeur (≥ 56 rem : tableur ; en dessous : vue téléphone). */}
      <div className="@container space-y-3">
      {msg && (
        <p ref={refMsg} role={msg.ok ? "status" : "alert"} className={`scroll-mt-16 rounded-md border px-3 py-2 text-sm ${msg.ok ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-destructive/40 bg-destructive/10 text-destructive"}`}>
          {msg.texte}
        </p>
      )}

      <VueTelephone
        lignes={lignes} setLignes={setLignes} articles={articles} optionsArt={optionsArt} fournisseurs={fournisseurs} idFourn={idFourn}
        taux={taux} aujourdhui={aujourdhui} date={date} setDate={choisirDate} origine={origine} setOrigine={setOrigine}
        deviseDefaut={deviseDefaut} changerDeviseDefaut={changerDeviseDefaut}
        stats={{ nb: lignes.filter(aEnregistrer).length, saisiUSD, saisiFC, aFrancs, fcEnUSD, totalUSD }}
        enCours={isPending} brouillon={brouillon}
      />

      <div className="hidden space-y-3 @4xl:block">
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">Date de l&apos;achat</span>
          <input type="date" name="date" value={date} max={aujourdhui} onChange={(e) => choisirDate(e.target.value)} className={inp} />
        </label>
        {/* Largeur plancher (hors téléphone) : sinon la devise par défaut et le taux l'écrasent à 1280 px. */}
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm sm:min-w-[16rem]">
          <span className="text-muted-foreground">Origine / libellé (optionnel)</span>
          <input name="origine" value={origine} onChange={(e) => setOrigine(e.target.value)} placeholder="Liste d'achat semaine…" className={inp} />
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
          <div ref={racine} data-tableur="" data-tableur-tab="natif" className="@4xl:space-y-0">
            {/* En-têtes de colonnes : UNE fois (la vue téléphone n'a pas de colonnes). */}
            <div className={`sticky colle-sous-entete z-10 hidden gap-1.5 rounded-md bg-muted px-0 py-1.5 text-xs font-medium text-muted-foreground @4xl:grid ${COLONNES}`}>
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
              return (
                <div key={i} data-ligne-achat className={`grid gap-1.5 ${COLONNES} @4xl:items-center @4xl:border-t @4xl:py-0.5`}>
                  <ChoixRecherche options={optionsArt} name="articleId" value={l.articleId} vide="— libre —" onChange={(id) => choisirArticle(i, id)} aria-label={`Article, ligne ${i + 1}`} className={champ} />
                  <input name="designation" placeholder="Désignation" aria-label={`Désignation, ligne ${i + 1}`} value={l.designation} onChange={(e) => majLigne(i, { designation: e.target.value })} readOnly={!libre} className={`${champ} ${!libre ? "text-muted-foreground" : ""}`} />
                  <input name="unite" placeholder="Kg…" aria-label={`Unité, ligne ${i + 1}`} value={l.unite} onChange={(e) => majLigne(i, { unite: e.target.value })} readOnly={!libre} className={`${champ} ${!libre ? "text-muted-foreground" : ""}`} />
                  {/* Domaine du NOUVEL article (création automatique au catalogue) — figé si article existant. */}
                  <select name="domaine" value={l.domaine} onChange={(e) => majLigne(i, { domaine: e.target.value })} disabled={!libre} aria-label={`Domaine, ligne ${i + 1}`} className={`${champ} disabled:opacity-60`}>
                    <option value="NOURRITURE">Nourriture</option>
                    <option value="BOISSON">Boisson</option>
                    <option value="AUTRE">Autre</option>
                  </select>
                  {!libre && <input type="hidden" name="domaine" value={l.domaine} />}
                  {/* Quantité, PU, montant : cases du tableur (sans flèches, Entrée descend). Ce qui part au serveur
                      est le champ caché à point ; le PU, FACULTATIF, n'est jamais envoyé — il sert à remplir le montant. */}
                  <input type="hidden" name="quantite" value={l.qte} />
                  <CelluleNombre ligne={String(i)} col={0} valeur={nombreOuNull(l.qte)} onEnregistrer={(v) => majLigne(i, { qte: texteDe(v) })}
                    onEntreeDerniereLigne={onEntreeDerniereLigne} min={0} quantite placeholder="Qté" className={`${champ} text-right`} aria-label={`Quantité, ligne ${i + 1}`} />
                  <CelluleNombre ligne={String(i)} col={1} valeur={nombreOuNull(l.pu)} onEnregistrer={(v) => majLigne(i, { pu: texteDe(v) })}
                    onEntreeDerniereLigne={onEntreeDerniereLigne} min={0} placeholder="PU" title="Prix unitaire (facultatif) — remplit le montant : quantité × PU"
                    className={`${champ} text-right`} aria-label={`Prix unitaire ${COURT[l.devise]}, ligne ${i + 1}`} />
                  <input type="hidden" name="montant" value={l.montant} />
                  {/* Montant + devise DE LA LIGNE, collés : « 28000 | FC ». Un appui sur la devise la bascule
                      (USD ⇄ FC) ; elle part avec la ligne (champ `devise` répété, dans l'ordre des lignes). */}
                  <div className="flex min-w-0">
                    <CelluleNombre ligne={String(i)} col={2} valeur={nombreOuNull(l.montant)} onEnregistrer={(v) => majLigne(i, { montant: texteDe(v) })}
                      onEntreeDerniereLigne={onEntreeDerniereLigne} min={0} placeholder="Montant"
                      title={`Montant payé pour la ligne (${COURT[l.devise]})${l.devise === "CDF" && nombreDeSaisie(l.montant) > 0 && taux > 0 ? ` ≈ ${formaterUSD(nombreDeSaisie(l.montant) / taux)}` : ""}`}
                      className={`${champ} rounded-r-none text-right`} aria-label={`Montant ${COURT[l.devise]}, ligne ${i + 1}`} />
                    <input type="hidden" name="devise" value={l.devise} />
                    <button type="button" data-devise-ligne={l.devise} onClick={() => basculerDevise(i)}
                      aria-label={`Devise de la ligne ${i + 1} : ${l.devise === "USD" ? "dollars (USD)" : "francs (FC)"} — changer en ${l.devise === "USD" ? "francs (FC)" : "dollars (USD)"}`}
                      title={l.devise === "USD" ? "Payé en dollars — appuyer pour passer en francs (FC)" : "Payé en francs — appuyer pour passer en dollars (USD)"}
                      className={`flex w-10 shrink-0 items-center justify-center self-stretch rounded-r border border-l-0 border-input text-xs font-bold ${l.devise === "CDF" ? "bg-amber-50 text-amber-900 hover:bg-amber-100" : "bg-muted text-foreground hover:bg-accent"}`}>
                      {COURT[l.devise]}
                    </button>
                  </div>
                  {/* Fournisseur DE CETTE LIGNE : suggestions des fournisseurs connus ; un nom nouveau est créé. */}
                  <input name="fournisseurNom" list="fournisseurs-connus" autoComplete="off" placeholder="Fournisseur" aria-label={`Fournisseur de la ligne ${i + 1}`} value={l.fournNom} onChange={(e) => majLigne(i, { fournNom: e.target.value })} className={champ} />
                  <input type="hidden" name="fournisseurId" value={idFourn(l.fournNom)} />
                  <button type="button" onClick={() => setLignes((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : ls.map((x, j) => (j === i ? vide(deviseDefautRef.current) : x))))} aria-label={`Retirer la ligne ${i + 1}`} title="Retirer la ligne"
                    className="flex h-8 w-8 items-center justify-center rounded-md border text-sm text-muted-foreground hover:bg-destructive/10 hover:text-destructive">✕</button>
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
      </div>

      <datalist id="fournisseurs-connus">
        {fournisseurs.map((f) => <option key={f.id} value={f.nom} />)}
      </datalist>
      {nouveauxFournisseurs.length > 0 && (
        <p className="hidden text-xs text-muted-foreground @4xl:block">Nouveau(x) fournisseur(s), créé(s) à l&apos;enregistrement : <b>{nouveauxFournisseurs.join(", ")}</b>.</p>
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

      <div className="hidden flex-wrap items-center gap-3 @4xl:flex">
        <button type="button" onClick={ajouterLigne} className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent">+ Ligne</button>
        <button disabled={isPending} className="rounded-md bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
          {isPending ? "Enregistrement…" : "Valider l'entrée en stock"}
        </button>
        <BoutonReinitialiser estDirection={estDirection} onClick={reinitialiser} />
      </div>
      <p className="hidden text-xs text-muted-foreground @4xl:block">Article du catalogue OU désignation libre : un nouvel article est <b>créé automatiquement au catalogue</b> (domaine choisi, unité et prix de cet achat comme référence) — une désignation identique retrouve l&apos;article existant. Prix unitaire et montant sont facultatifs — le PU remplit le montant (quantité × PU), ajustable. Chaque ligne a sa devise (USD ou FC) ; une ligne en FC est convertie en USD au taux courant (nourrit l&apos;évolution du prix d&apos;achat).</p>
      </div>
    </form>
  );
}

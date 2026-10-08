"use client";

// Liste d'achat — présentation TÉLÉPHONE (et tablette étroite) : la liste est un RÉCAPITULATIF (une carte
// lisible par article : toucher = modifier, ✕ = retirer, avec « Annuler »), et la saisie d'un article se
// fait dans un PANNEAU PLEIN ÉCRAN aux champs empilés (cibles de 44 px et plus, police de 16 px : iOS ne
// zoome pas). Le tableur de l'ordinateur (entree-client.tsx) reste tel quel ; les deux vues lisent et
// écrivent la MÊME liste (`lignes`) et partent par le MÊME envoi (`construireFormData`).
//
// Barre du bas : `sticky bottom-0` dans la zone qui défile — la coquille réserve déjà la place de la barre
// de navigation, la barre de total s'arrête donc au-dessus d'elle. Pas de flou ni de fond translucide sur
// un élément collant (piège PWA iOS). Le panneau passe par un portail (un ancêtre `overflow: hidden`
// recadre un `position: fixed` sur Safari iOS) et se cale sur la zone VISIBLE (le clavier la réduit).
//
// Non vérifié sur un vrai appareil : le clavier virtuel d'iOS et le calage du panneau (voir le compte rendu).
import { useEffect, useId, useMemo, useRef, useState, type Dispatch, type MouseEvent as ReactMouseEvent, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { BulkBar, useBulkSelection } from "@/components/bulk-bar";
import { BoutonDanger, BoutonNeutre } from "@/components/action-buttons";
import { ChampNombre } from "@/components/champ-nombre";
import { ChoixRecherche } from "@/components/choix-recherche";
import { useLockBodyScroll } from "@/components/use-lock-body-scroll";
import { formaterFC, formaterMontant, formaterNombre, formaterUSD } from "@/lib/montant";
import { nombreDeSaisie } from "@/lib/saisie-nombre-stock";
import type { OptionChoix } from "@/lib/recherche-options";
import {
  avecArticle, avecChangement, avecDevise, erreursDe, fournisseursProches, jourCourt, lignesAConfirmer, montantNonConverti, phraseDevise, rangee, sansErreur, vide, vierge,
  type Art, type Brouillon, type Devise, type EtatLigne, type Fourn, type Ligne,
} from "@/lib/liste-achat-saisie";
import type { ArticleCandidat } from "@/lib/achats-doublons";
import { AlertesLigne } from "./alertes-ligne";

const COURT: Record<Devise, string> = { USD: "USD", CDF: "FC" };
/** Champ du panneau : 48 px de haut, 16 px de police (iOS ne zoome pas), même bordure que les champs du logiciel. */
const CHAMP = "h-12 w-full min-w-0 rounded-md border border-input bg-background px-3 text-base";
const ETIQUETTE = "mb-1 block text-sm font-medium";
const ERREUR = "mt-1 text-sm text-destructive";

export type StatsListe = { nb: number; saisiUSD: number; saisiFC: number; aFrancs: boolean; fcEnUSD: number | null; totalUSD: number | null };

type Props = {
  lignes: Ligne[];
  setLignes: Dispatch<SetStateAction<Ligne[]>>;
  articles: Art[];
  optionsArt: OptionChoix[];
  fournisseurs: Fourn[];
  /** Nom tapé → id du fournisseur connu (« » si nouveau) : la règle de l'envoi. */
  idFourn: (nom: string) => string;
  taux: number;
  aujourdhui: string;
  date: string;
  setDate: (d: string) => void;
  origine: string;
  setOrigine: (o: string) => void;
  deviseDefaut: Devise;
  changerDeviseDefaut: (d: Devise) => void;
  stats: StatsListe;
  enCours: boolean;
  brouillon: { trouve: Brouillon | null; reprendre: () => void; ignorer: () => void };
  /** Anti-doublon et DLC de chaque ligne (même calcul que le tableur), et les choix qu'on y fait. */
  etats: EtatLigne[];
  utiliser: (i: number, c: ArticleCandidat) => void;
  creerQuandMeme: (i: number, oui: boolean) => void;
};

/** Choix à deux ou trois boutons côte à côte (devise, domaine) : un appui, pas de liste à ouvrir. */
function Segments<T extends string>({ valeur, options, onChange, label }: { valeur: T; options: { valeur: T; libelle: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="grid auto-cols-fr grid-flow-col overflow-hidden rounded-md border">
      {options.map((o, k) => (
        <button key={o.valeur} type="button" aria-pressed={valeur === o.valeur} onClick={() => onChange(o.valeur)}
          className={`min-h-12 px-3 text-base font-medium ${k > 0 ? "border-l" : ""} ${valeur === o.valeur ? "bg-primary text-primary-foreground" : "bg-background hover:bg-accent"}`}>
          {o.libelle}
        </button>
      ))}
    </div>
  );
}
const DEVISES: { valeur: Devise; libelle: string }[] = [{ valeur: "USD", libelle: "Dollars ($)" }, { valeur: "CDF", libelle: "Francs (FC)" }];

/** Zone réellement visible (le clavier d'un téléphone réduit `visualViewport`) : le panneau s'y cale, ses boutons restent au-dessus du clavier. */
function useZoneVisible() {
  const [zone, setZone] = useState<{ top: number; height: number } | null>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const maj = () => setZone({ top: vv.offsetTop, height: vv.height });
    maj();
    vv.addEventListener("resize", maj);
    vv.addEventListener("scroll", maj);
    return () => { vv.removeEventListener("resize", maj); vv.removeEventListener("scroll", maj); };
  }, []);
  return zone;
}

/**
 * Confirmation d'un changement de devise : un montant TAPÉ est celui du ticket, il n'est pas converti — seule sa devise change
 * (« 28 $ deviendra 28 FC »). Seul un PU du catalogue est converti au taux. Rien n'est appliqué sans cet accord.
 */
function ConfirmerDevise({ lignes, devise, titres, onOui, onNon }: { lignes: Ligne[]; devise: Devise; titres: string[]; onOui: () => void; onNon: () => void }) {
  const n = lignes.length;
  return (
    <div role="alertdialog" aria-label="Confirmer le changement de devise" data-confirmer-devise className="space-y-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      <p className="font-medium">{n} montant{n > 1 ? "s saisis ne sont" : " saisi n'est"} pas converti{n > 1 ? "s" : ""} : le nombre reste, seule la devise change.</p>
      <ul className="list-disc space-y-0.5 pl-5">
        {lignes.map((l, k) => <li key={k}>{titres[k]} : {phraseDevise(l, devise)}</li>)}
      </ul>
      <div className="flex gap-2">
        <button type="button" onClick={onOui} className="min-h-11 flex-1 rounded-md bg-primary px-3 font-medium text-primary-foreground">Changer la devise</button>
        <button type="button" onClick={onNon} className="min-h-11 flex-1 rounded-md border bg-background px-3 font-medium text-foreground">Garder la devise</button>
      </div>
    </div>
  );
}

const titreDe = (l: Ligne, parId: Map<string, Art>) => l.designation.trim() || parId.get(l.articleId)?.designation || "Article sans nom";

/** « 3 kg × 18,00 $ = 54,00 $ » — ce que la ligne enregistrera ; alerte si elle serait ignorée (quantité absente). La DLC est montrée à part. */
function calculDe(l: Ligne): { texte: string; alerte: boolean } {
  const q = nombreDeSaisie(l.qte);
  if (!(q > 0)) return { texte: "Quantité manquante : cette ligne ne sera pas enregistrée.", alerte: true };
  const p = nombreDeSaisie(l.pu);
  const m = nombreDeSaisie(l.montant);
  const qte = `${formaterNombre(q, { maximumFractionDigits: 4 })}${l.unite.trim() ? ` ${l.unite.trim()}` : ""}`;
  const f = (n: number) => formaterMontant(n, l.devise);
  if (m > 0 && p > 0) return { texte: `${qte} × ${f(p)} = ${f(m)}`, alerte: false };
  if (m > 0) return { texte: `${qte} · ${f(m)}`, alerte: false };
  return { texte: `${qte} · prix non saisi`, alerte: false };
}

// ── Le panneau plein écran d'un article ─────────────────────────────────────────────────────────────────

function PanneauArticle({ mode, initial, articles, optionsArt, fournisseurs, idFourn, taux, nbDansListe, dateAchat, onValider, onFermer }: {
  mode: "ajout" | "modif";
  initial: Ligne;
  /** Date de l'achat : la DLC ne peut pas la précéder. */
  dateAchat: string;
  articles: Art[];
  optionsArt: OptionChoix[];
  fournisseurs: Fourn[];
  idFourn: (nom: string) => string;
  taux: number;
  nbDansListe: number;
  onValider: (l: Ligne, suite: boolean) => void;
  onFermer: () => void;
}) {
  useLockBodyScroll(true);
  const zone = useZoneVisible();
  const idTitre = useId();
  const corps = useRef<HTMLDivElement>(null);
  const parId = useMemo(() => new Map(articles.map((a) => [a.id, a])), [articles]);
  const [l, setL] = useState<Ligne>(initial);
  const [essaye, setEssaye] = useState(false); // les refus ne s'affichent qu'après une tentative de validation
  const [dernier, setDernier] = useState<string | null>(null); // « X ajouté » après « Ajouter et suivant »
  const [confirmer, setConfirmer] = useState(false);
  const [changerDevise, setChangerDevise] = useState<Devise | null>(null); // devise demandée, en attente d'accord
  // Un article hors catalogue se saisit à part (nom + domaine) : ces champs n'encombrent pas le cas courant, le choix dans la liste.
  const [libreOuvert, setLibreOuvert] = useState(!initial.articleId && !!initial.designation.trim());
  const erreurs = essaye ? erreursDe(l, dateAchat) : {};
  const libre = !l.articleId;
  const montreLibre = libre && libreOuvert;
  const contenu = !!(l.articleId || l.designation.trim() || l.qte || l.pu || l.montant || l.dlc);
  const modifie = mode === "modif" ? JSON.stringify(rangee(l)) !== JSON.stringify(rangee(initial)) : contenu;
  const demanderFermer = () => { if (modifie) setConfirmer(true); else onFermer(); };
  const maj = (patch: Partial<Ligne>) => setL((x) => avecChangement(x, patch));
  const premierChamp = () => corps.current?.querySelector<HTMLInputElement>('input[role="combobox"]');

  // Échap ferme (la liste d'articles ouverte garde son propre Échap) ; le premier champ prend le focus à l'ouverture.
  const fermeture = useRef(demanderFermer);
  useEffect(() => { fermeture.current = demanderFermer; });
  useEffect(() => {
    const surTouche = (e: KeyboardEvent) => { if (e.key === "Escape") fermeture.current(); };
    window.addEventListener("keydown", surTouche);
    if (mode === "ajout") premierChamp()?.focus();
    return () => window.removeEventListener("keydown", surTouche);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- à l'ouverture seulement
  }, []);

  const valider = (suite: boolean) => {
    if (!suite && mode === "ajout" && !contenu) { onFermer(); return; } // « Terminé » sans rien saisi : on ferme
    if (!sansErreur(erreursDe(l, dateAchat))) {
      setEssaye(true);
      return;
    }
    const ligne = rangee(l);
    onValider(ligne, suite);
    if (suite) {
      // Le suivant : la devise et le fournisseur restent (une même course, un même ticket), le reste repart à vide.
      setDernier(titreDe(ligne, parId));
      setL({ ...vide(ligne.devise), fournNom: ligne.fournNom });
      setLibreOuvert(false);
      setEssaye(false);
      corps.current?.scrollTo?.({ top: 0 });
      premierChamp()?.focus();
    }
  };

  const m = nombreDeSaisie(l.montant);
  const q = nombreDeSaisie(l.qte);
  const proches = fournisseursProches(l.fournNom, fournisseurs);
  const nouveau = l.fournNom.trim() !== "" && idFourn(l.fournNom) === "";

  return createPortal(
    <div role="dialog" aria-modal="true" aria-labelledby={idTitre} data-panneau-achat
      onKeyDown={(e) => {
        // Le focus reste dans le panneau : Tab boucle du dernier champ au premier (et Maj+Tab à l'inverse).
        if (e.key !== "Tab") return;
        const f = [...e.currentTarget.querySelectorAll<HTMLElement>("input:not([type=hidden]):not([disabled]):not([readonly]), button:not([disabled])")];
        if (f.length === 0) return;
        const premier = f[0], dernier = f[f.length - 1];
        if (e.shiftKey && document.activeElement === premier) { e.preventDefault(); dernier.focus(); }
        else if (!e.shiftKey && document.activeElement === dernier) { e.preventDefault(); premier.focus(); }
      }}
      style={zone ? { top: zone.top, height: zone.height } : undefined}
      className="fixed inset-x-0 top-0 z-[60] flex h-dvh flex-col bg-background">
      <div className="flex shrink-0 items-center gap-2 border-b px-4 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <div className="min-w-0 flex-1">
          <h2 id={idTitre} className="truncate text-lg font-semibold">{mode === "ajout" ? "Ajouter un article" : "Modifier l'article"}</h2>
          {mode === "ajout" && <p className="text-xs text-muted-foreground">{nbDansListe === 0 ? "Liste vide pour l'instant" : `${nbDansListe} article${nbDansListe > 1 ? "s" : ""} déjà dans la liste`}</p>}
        </div>
        <button type="button" onClick={demanderFermer} aria-label="Fermer sans ajouter" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border text-lg text-muted-foreground hover:bg-accent">✕</button>
      </div>

      <div ref={corps} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
        <div className="mx-auto max-w-xl space-y-5">
          {confirmer && (
            <div role="alertdialog" aria-label="Abandonner la saisie" className="space-y-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <p>Cette saisie n&apos;est pas encore dans la liste. L&apos;abandonner ?</p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setConfirmer(false)} className="min-h-11 flex-1 rounded-md border bg-background px-3 font-medium text-foreground">Continuer la saisie</button>
                <button type="button" onClick={onFermer} className="min-h-11 flex-1 rounded-md border border-destructive px-3 font-medium text-destructive">Abandonner</button>
              </div>
            </div>
          )}
          {dernier && <p role="status" className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">« {dernier} » ajouté à la liste. Article suivant :</p>}

          <div>
            <label className={ETIQUETTE} htmlFor={`${idTitre}-article`}>Article</label>
            <ChoixRecherche id={`${idTitre}-article`} options={optionsArt} value={l.articleId} vide="— libre —" placeholder="Taper le nom de l'article" aria-label="Article"
              onChange={(id) => { setL((x) => avecArticle(x, parId.get(id), taux)); if (id) setLibreOuvert(false); }} className={CHAMP} />
            {erreurs.article && <p role="alert" className={ERREUR}>{erreurs.article}</p>}
            {libre && !libreOuvert && (
              <button type="button" onClick={() => setLibreOuvert(true)} className="mt-1 min-h-11 text-left text-sm font-medium text-primary underline">L&apos;article n&apos;est pas dans la liste ? Saisir un nouvel article</button>
            )}
          </div>

          {montreLibre && (
            <>
              <div>
                <label className={ETIQUETTE} htmlFor={`${idTitre}-designation`}>Nom du nouvel article</label>
                <input id={`${idTitre}-designation`} value={l.designation} onChange={(e) => maj({ designation: e.target.value })} placeholder="Ex. Sucre en poudre" autoComplete="off" className={CHAMP} />
                <p className="mt-1 text-xs text-muted-foreground">Un nom nouveau crée l&apos;article au catalogue ; un nom déjà connu retrouve l&apos;article existant.</p>
              </div>
              <div>
                <span className={ETIQUETTE}>Domaine du nouvel article</span>
                <Segments label="Domaine" valeur={l.domaine} onChange={(v) => maj({ domaine: v })}
                  options={[{ valeur: "NOURRITURE", libelle: "Nourriture" }, { valeur: "BOISSON", libelle: "Boisson" }, { valeur: "AUTRE", libelle: "Autre" }]} />
              </div>
            </>
          )}

          <div>
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <label className={ETIQUETTE} htmlFor={`${idTitre}-qte`}>Quantité</label>
                <ChampNombre id={`${idTitre}-qte`} value={l.qte} onChange={(e) => maj({ qte: e.target.value })} placeholder="0" aria-label="Quantité" aria-invalid={!!erreurs.qte || undefined}
                  suffixe={l.unite.trim()} alerteMilliers classeConteneur="w-full" className={`${CHAMP} text-right`} />
              </div>
              <div className="w-28 shrink-0">
                <label className={ETIQUETTE} htmlFor={`${idTitre}-unite`}>Unité</label>
                <input id={`${idTitre}-unite`} value={l.unite} onChange={(e) => maj({ unite: e.target.value })} readOnly={!libre} placeholder="kg, sac…" autoComplete="off" aria-label="Unité"
                  className={`${CHAMP} ${!libre ? "text-muted-foreground" : ""}`} />
              </div>
            </div>
            {erreurs.qte && <p role="alert" className={ERREUR}>{erreurs.qte}</p>}
          </div>

          <div>
            <label className={ETIQUETTE} htmlFor={`${idTitre}-dlc`}>DLC <span className="font-normal text-muted-foreground">(facultatif)</span></label>
            <input id={`${idTitre}-dlc`} type="date" value={l.dlc} min={dateAchat || undefined} onChange={(e) => maj({ dlc: e.target.value })} aria-label="DLC (facultatif)" aria-invalid={!!erreurs.dlc || undefined} className={CHAMP} />
            <p className="mt-1 text-xs text-muted-foreground">Date limite de consommation, si elle est sur l&apos;emballage. Jamais avant la date de l&apos;achat.</p>
            {erreurs.dlc && <p role="alert" className={ERREUR}>{erreurs.dlc}</p>}
          </div>

          <div>
            <span className={ETIQUETTE}>Payé en</span>
            <Segments label="Devise de la ligne" valeur={l.devise} options={DEVISES}
              onChange={(d) => { if (d !== l.devise && montantNonConverti(l, taux)) setChangerDevise(d); else { setChangerDevise(null); setL((x) => avecDevise(x, d, taux)); } }} />
            {changerDevise && (
              <div className="mt-2">
                <ConfirmerDevise lignes={[l]} devise={changerDevise} titres={[titreDe(l, parId)]} onNon={() => setChangerDevise(null)}
                  onOui={() => { setL((x) => avecDevise(x, changerDevise, taux)); setChangerDevise(null); }} />
              </div>
            )}
          </div>

          <div>
            <div className="grid grid-cols-2 items-start gap-3">
              <div className="min-w-0">
                <label className={ETIQUETTE} htmlFor={`${idTitre}-pu`}>Prix unitaire ({COURT[l.devise]})</label>
                <ChampNombre id={`${idTitre}-pu`} value={l.pu} onChange={(e) => maj({ pu: e.target.value })} placeholder="facultatif" aria-label={`Prix unitaire ${COURT[l.devise]}`} aria-invalid={!!erreurs.pu || undefined}
                  suffixe={COURT[l.devise]} alerteMilliers classeConteneur="w-full" className={`${CHAMP} text-right`} />
                {erreurs.pu && <p role="alert" className={ERREUR}>{erreurs.pu}</p>}
              </div>
              <div className="min-w-0">
                <label className={ETIQUETTE} htmlFor={`${idTitre}-montant`}>Montant total ({COURT[l.devise]})</label>
                {/* Taper le montant détache le PU : le montant tapé est celui du ticket, jamais recalculé ensuite. */}
                <ChampNombre id={`${idTitre}-montant`} value={l.montant} onChange={(e) => maj({ montant: e.target.value, pu: "" })} placeholder="facultatif" aria-label={`Montant total ${COURT[l.devise]}`} aria-invalid={!!erreurs.montant || undefined}
                  suffixe={COURT[l.devise]} alerteMilliers classeConteneur="w-full" className={`${CHAMP} text-right font-semibold`} />
                {erreurs.montant && <p role="alert" className={ERREUR}>{erreurs.montant}</p>}
              </div>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Tapez le prix unitaire <b>ou</b> le montant total : l&apos;autre se calcule.</p>
            {m > 0 && q > 0 && l.pu === "" && <p data-aide-pu className="mt-1 text-sm tabular-nums">soit {formaterMontant(m / q, l.devise)} l&apos;unité</p>}
            {l.devise === "CDF" && m > 0 && (taux > 0
              ? <p className="mt-1 text-sm tabular-nums text-muted-foreground">≈ {formaterUSD(m / taux)} au taux du jour</p>
              : <p role="status" className="mt-1 text-sm font-medium text-amber-800">Taux CDF/USD non défini (Paramètres) : une ligne en FC avec un montant sera refusée à l&apos;enregistrement.</p>)}
          </div>

          <div>
            <label className={ETIQUETTE} htmlFor={`${idTitre}-fourn`}>Fournisseur <span className="font-normal text-muted-foreground">(facultatif)</span></label>
            <input id={`${idTitre}-fourn`} list="fournisseurs-connus" autoComplete="off" value={l.fournNom} onChange={(e) => maj({ fournNom: e.target.value })} placeholder="Nom du fournisseur" className={CHAMP} />
            {proches.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2" data-fournisseurs-proches>
                {proches.map((f) => (
                  <button key={f.id} type="button" onClick={() => maj({ fournNom: f.nom })} className="min-h-11 rounded-full border px-4 text-sm hover:bg-accent">{f.nom}</button>
                ))}
              </div>
            )}
            {nouveau && <p className="mt-1 text-xs text-muted-foreground">Nouveau fournisseur : « {l.fournNom.trim()} » sera créé à l&apos;enregistrement.</p>}
          </div>
        </div>
      </div>

      <div className="shrink-0 border-t bg-background px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
        <div className="mx-auto flex max-w-xl gap-3">
          {mode === "ajout" ? (
            <>
              <button type="button" onClick={() => valider(true)} className="min-h-12 flex-1 rounded-md bg-primary px-3 text-base font-semibold text-primary-foreground">Ajouter et suivant</button>
              <button type="button" onClick={() => valider(false)} className="min-h-12 flex-1 rounded-md border px-3 text-base font-medium hover:bg-accent">Terminé</button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => valider(false)} className="min-h-12 flex-1 rounded-md bg-primary px-3 text-base font-semibold text-primary-foreground">Mettre à jour</button>
              <button type="button" onClick={onFermer} className="min-h-12 flex-1 rounded-md border px-3 text-base font-medium hover:bg-accent">Annuler</button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── La vue : récapitulatif + barre de total ──────────────────────────────────────────────────────────────

type Panneau = null | { mode: "ajout" } | { mode: "modif"; index: number };

export function VueTelephone({ lignes, setLignes, articles, optionsArt, fournisseurs, idFourn, taux, aujourdhui, date, setDate, origine, setOrigine, deviseDefaut, changerDeviseDefaut, stats, enCours, brouillon, etats, utiliser, creerQuandMeme }: Props) {
  const [panneau, setPanneau] = useState<Panneau>(null);
  const ouvreur = useRef<HTMLElement | null>(null); // le bouton qui a ouvert le panneau : le focus lui revient à la fermeture
  const [confirmerGroupe, setConfirmerGroupe] = useState<{ devise: Devise; cibles: number[]; aConfirmer: number[] } | null>(null);
  const [reglages, setReglages] = useState(false); // ligne « date · origine » dépliée
  const [retire, setRetire] = useState<{ ligne: Ligne; index: number }[] | null>(null); // dernier retrait, pour « Annuler »
  const { sel, toggle, clear, setAll } = useBulkSelection();
  const parId = useMemo(() => new Map(articles.map((a) => [a.id, a])), [articles]);

  // Seules les lignes où quelque chose est saisi sont des cartes : les lignes vides du tableur n'existent pas ici.
  const visibles = lignes.map((l, i) => ({ l, i })).filter(({ l }) => !vierge(l));
  const cochees = visibles.filter(({ i }) => sel.has(String(i))).map(({ i }) => i);

  // L'annulation du dernier retrait s'efface d'elle-même.
  useEffect(() => {
    if (!retire) return;
    const t = setTimeout(() => setRetire(null), 8000);
    return () => clearTimeout(t);
  }, [retire]);

  const ouvrirAjout = (e: ReactMouseEvent<HTMLElement>) => { ouvreur.current = e.currentTarget; setRetire(null); setPanneau({ mode: "ajout" }); };
  useEffect(() => { if (!panneau && ouvreur.current?.isConnected) ouvreur.current.focus(); }, [panneau]);

  const valider = (ligne: Ligne, suite: boolean) => {
    if (panneau?.mode === "modif") {
      const index = panneau.index;
      setLignes((ls) => ls.map((x, j) => (j === index ? ligne : x)));
      setPanneau(null);
      return;
    }
    // Ajout : la première ligne vide APRÈS la dernière ligne saisie (les lignes vides du tableur sont consommées d'abord), sinon une de plus.
    setLignes((ls) => {
      let dernierSaisi = -1;
      ls.forEach((x, j) => { if (!vierge(x)) dernierSaisi = j; });
      const k = ls.findIndex((x, j) => j > dernierSaisi && vierge(x));
      return k >= 0 ? ls.map((x, j) => (j === k ? ligne : x)) : [...ls, ligne];
    });
    clear();
    if (!suite) setPanneau(null);
  };

  const retirer = (indices: number[]) => {
    setRetire(indices.map((i) => ({ ligne: lignes[i], index: i })));
    setLignes((ls) => {
      const reste = ls.filter((_, j) => !indices.includes(j));
      return reste.length > 0 ? reste : [vide(deviseDefaut)];
    });
    clear();
  };
  const annulerRetrait = () => {
    if (!retire) return;
    const aRemettre = [...retire].sort((a, b) => a.index - b.index);
    setLignes((ls) => {
      const r = ls.every(vierge) ? [] : [...ls]; // la ligne vide mise à la place d'une liste entièrement retirée s'efface
      for (const { ligne, index } of aRemettre) r.splice(Math.min(index, r.length), 0, ligne);
      return r;
    });
    setRetire(null);
  };
  const appliquerDevise = (d: Devise, cibles: number[]) => { setLignes((ls) => ls.map((x, j) => (cibles.includes(j) ? avecDevise(x, d, taux) : x))); setConfirmerGroupe(null); };
  // Les montants TAPÉS ne sont pas convertis : on fait confirmer, en nommant chaque ligne concernée.
  const passerEn = (d: Devise) => {
    const aConfirmer = cochees.filter((j) => lignesAConfirmer([lignes[j]], d, taux).length > 0);
    if (aConfirmer.length > 0) setConfirmerGroupe({ devise: d, cibles: cochees, aConfirmer });
    else appliquerDevise(d, cochees);
  };
  const reprendre = () => { clear(); setConfirmerGroupe(null); brouillon.reprendre(); };

  const totaux = [stats.saisiUSD > 0 ? formaterUSD(stats.saisiUSD) : null, stats.saisiFC > 0 ? formaterFC(stats.saisiFC) : null].filter(Boolean).join(" + ");
  const b = brouillon.trouve;

  return (
    <div data-vue-telephone className="space-y-3 @4xl:hidden">
      {/* Date et origine : une ligne compacte, dépliée d'un toucher. */}
      <div className="rounded-lg border">
        <button type="button" onClick={() => setReglages((o) => !o)} aria-expanded={reglages} className="flex min-h-12 w-full items-center gap-2 px-3 py-1.5 text-left">
          <span className="min-w-0 flex-1">
            <span data-date-resume className={`block text-sm font-medium ${date && date !== aujourdhui ? "font-semibold text-amber-800" : ""}`}>
              {date === aujourdhui ? "Aujourd'hui · " : date ? "Achat du " : ""}{date ? jourCourt(date) : "Date à choisir"}{date && date !== aujourdhui ? " · pas aujourd'hui" : ""}
            </span>
            <span className="block truncate text-xs text-muted-foreground">{origine.trim() || "Liste d'achat"} · devise par défaut {COURT[deviseDefaut]}</span>
          </span>
          <span aria-hidden className="text-sm text-muted-foreground">{reglages ? "Fermer" : "Modifier"}</span>
        </button>
        {reglages && (
          <div className="space-y-4 border-t p-3">
            <div>
              <label className={ETIQUETTE} htmlFor="tel-date">Date de l&apos;achat</label>
              <input id="tel-date" type="date" value={date} max={aujourdhui} onChange={(e) => setDate(e.target.value)} className={CHAMP} />
            </div>
            <div>
              <label className={ETIQUETTE} htmlFor="tel-origine">Origine / libellé <span className="font-normal text-muted-foreground">(facultatif)</span></label>
              <input id="tel-origine" value={origine} onChange={(e) => setOrigine(e.target.value)} placeholder="Liste d'achat semaine…" className={CHAMP} />
            </div>
            <div>
              <span className={ETIQUETTE}>Devise par défaut des nouveaux articles</span>
              <Segments label="Devise par défaut" valeur={deviseDefaut} options={DEVISES} onChange={changerDeviseDefaut} />
              <p className="mt-1 text-xs text-muted-foreground">{taux > 0 ? `Taux : 1 USD = ${formaterNombre(taux)} FC (les lignes en FC sont converties automatiquement).` : "Taux CDF/USD non défini (Paramètres) : une ligne en FC avec un montant sera refusée."}</p>
            </div>
          </div>
        )}
      </div>

      {b && (
        <div role="status" data-brouillon className="space-y-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <p><b>Brouillon{b.jour ? ` du ${jourCourt(b.jour)}` : ""} retrouvé</b> : {b.lignes.length} article{b.lignes.length > 1 ? "s" : ""} non enregistré{b.lignes.length > 1 ? "s" : ""}.</p>
          {b.date && <p>Elle sera reprise avec la date de l&apos;achat : <b>{jourCourt(b.date)}</b>.</p>}
          <div className="flex gap-2">
            <button type="button" onClick={reprendre} className="min-h-11 flex-1 rounded-md bg-primary px-3 font-medium text-primary-foreground">Reprendre</button>
            <button type="button" onClick={brouillon.ignorer} className="min-h-11 flex-1 rounded-md border border-destructive bg-background px-3 font-medium text-destructive">Effacer</button>
          </div>
        </div>
      )}

      <button type="button" onClick={ouvrirAjout} className="flex min-h-14 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-base font-semibold text-primary-foreground">
        <span aria-hidden className="text-xl leading-none">+</span> Ajouter un article
      </button>

      {visibles.length === 0 ? (
        <p data-liste-vide className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">Aucun article pour l&apos;instant. Touchez « Ajouter un article » pour commencer la liste.</p>
      ) : (
        <>
          <BulkBar count={cochees.length} total={visibles.length} onAll={(on) => setAll(visibles.map(({ i }) => String(i)), on)}>
            <BoutonNeutre type="button" className="min-h-11" onClick={() => passerEn("USD")}>Passer en USD</BoutonNeutre>
            <BoutonNeutre type="button" className="min-h-11" onClick={() => passerEn("CDF")}>Passer en FC</BoutonNeutre>
            <BoutonDanger type="button" className="min-h-11" onClick={() => retirer(cochees)}>✕ Retirer ({cochees.length})</BoutonDanger>
          </BulkBar>
          {confirmerGroupe && (
            <ConfirmerDevise lignes={confirmerGroupe.aConfirmer.map((j) => lignes[j])} devise={confirmerGroupe.devise}
              titres={confirmerGroupe.aConfirmer.map((j) => titreDe(lignes[j], parId))}
              onOui={() => appliquerDevise(confirmerGroupe.devise, confirmerGroupe.cibles)} onNon={() => setConfirmerGroupe(null)} />
          )}
          <ul className="space-y-2">
            {visibles.map(({ l, i }) => {
              const titre = titreDe(l, parId);
              const c = calculDe(l);
              const idF = idFourn(l.fournNom);
              return (
                <li key={i} data-carte-achat className={`flex items-stretch gap-1 rounded-lg border ${sel.has(String(i)) ? "bg-primary/10" : "bg-card"}`}>
                  <label className="flex w-11 shrink-0 items-center justify-center">
                    <input type="checkbox" checked={sel.has(String(i))} onChange={() => toggle(String(i))} className="h-5 w-5" aria-label={`Sélectionner ${titre}`} />
                  </label>
                  <div className="min-w-0 flex-1 py-1.5">
                    <button type="button" data-modifier onClick={(e) => { ouvreur.current = e.currentTarget; setPanneau({ mode: "modif", index: i }); }} className="block w-full text-left">
                      <span className="block truncate font-medium">{titre}</span>
                      <span className={`block text-sm tabular-nums ${c.alerte ? "text-amber-800" : "text-muted-foreground"}`}>{c.texte}</span>
                    </button>
                    {l.fournNom.trim() && (
                      <span className="block truncate text-xs text-muted-foreground">
                        {idF ? <Link href={`/stock/fournisseurs/${idF}`} className="inline-block py-1 text-primary hover:underline">{l.fournNom.trim()}</Link> : <>{l.fournNom.trim()} (nouveau fournisseur)</>}
                      </span>
                    )}
                    {l.dlc && <span data-dlc-carte className="block text-xs text-muted-foreground">DLC {jourCourt(l.dlc)}</span>}
                    {etats[i] && (
                      <div className="pb-1 pr-1 pt-1">
                        <AlertesLigne ligne={l} etat={etats[i]} nom={titre} tactile
                          autres={(js) => (js.length > 1 ? `sur ${js.length} autres cartes` : "sur une autre carte")}
                          onUtiliser={(c) => utiliser(i, c)} onCreer={(oui) => creerQuandMeme(i, oui)} />
                      </div>
                    )}
                  </div>
                  <button type="button" onClick={() => retirer([i])} aria-label={`Retirer ${titre}`} className="flex w-11 shrink-0 items-center justify-center rounded-r-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive">✕</button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {(visibles.length > 0 || retire) && (
        <div data-barre-total className="sticky bottom-0 z-20 -mx-4 space-y-2 border-t bg-background px-4 pb-2 pt-2 lg:-mx-8 lg:px-8">
          {retire && (
            <div role="status" data-retrait className="flex items-center justify-between gap-3 rounded-md border bg-muted px-3 py-1.5 text-sm">
              <span>{retire.length > 1 ? `${retire.length} articles retirés` : "Article retiré"}</span>
              <button type="button" onClick={annulerRetrait} className="min-h-11 px-2 font-semibold text-primary">Annuler</button>
            </div>
          )}
          {visibles.length > 0 && (
            <div className="flex items-center gap-3">
              <div data-total-telephone aria-live="polite" className="min-w-0 flex-1 text-sm tabular-nums">
                <p className="font-semibold">{stats.nb} article{stats.nb > 1 ? "s" : ""}</p>
                <p className="break-words">{totaux || <span className="text-muted-foreground">prix non saisis</span>}</p>
                {stats.aFrancs && (
                  <p className="text-xs text-muted-foreground">{stats.fcEnUSD === null || stats.totalUSD === null ? "Taux non défini : francs non convertis" : `≈ ${formaterUSD(stats.totalUSD)} au taux du jour`}</p>
                )}
              </div>
              <button type="submit" disabled={enCours || stats.nb === 0} className="min-h-12 shrink-0 rounded-md bg-primary px-4 text-base font-semibold text-primary-foreground disabled:opacity-50">
                {enCours ? "Enregistrement…" : "Enregistrer la liste"}
              </button>
            </div>
          )}
        </div>
      )}

      {panneau && (
        <PanneauArticle
          key={panneau.mode === "modif" ? `m${panneau.index}` : "a"}
          mode={panneau.mode}
          initial={panneau.mode === "modif" ? lignes[panneau.index] ?? vide(deviseDefaut) : vide(deviseDefaut)}
          articles={articles} optionsArt={optionsArt} fournisseurs={fournisseurs} idFourn={idFourn} taux={taux}
          nbDansListe={visibles.length}
          dateAchat={date}
          onValider={valider}
          onFermer={() => setPanneau(null)}
        />
      )}
    </div>
  );
}

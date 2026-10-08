"use client";

import Link from "next/link";
import { EtatVide } from "@/components/etat-vide";
import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { creerArticle, modifierArticle, categoriserEnMasse, fusionnerArticles, basculerActifArticles, basculerFicheCommande, definirFournisseurEnMasse, definirSeuilEnMasse, corrigerStocksNegatifs } from "./actions";
import { ALERTE_CLASSE, ALERTE_LABEL, DOMAINE_LABEL, usd, type NiveauAlerte } from "@/lib/stock";
import { estErreur } from "@/lib/action-lisible";
import { CelluleNombre } from "@/components/tableur/cellule-nombre";
import { ZoneTableur } from "@/components/tableur/messages";
import { ecrireSaisieNombre, lireSaisieNombre, MOTIF_HTML_DECIMAL_POSITIF } from "@/lib/nombre";
import { nombreDeBase } from "@/lib/saisie-nombre-stock";
import { formaterFC, formaterNombre } from "@/lib/montant";
import { ChoixRecherche } from "@/components/choix-recherche";
import { optionsFournisseurs, type OptionChoix } from "@/lib/recherche-options";
import { Pagination, usePagination } from "@/components/pagination";
import { tranche, type ParPage } from "@/lib/pagination";

/** Texte envoyé à `modifierArticle` (lu à la française par `decSaisiOptionnel`) : vide = effacer. Les
 *  valeurs venues de la base (« 12.5 ») pré-remplissent les cases par `nombreDeBase`, jamais par la lecture française. */
const texteDe = (v: number | null) => (v === null ? "" : ecrireSaisieNombre(v));

/**
 * Valeur du stock d'un article EN DOLLARS. Calculée par le serveur (`valeurUSD`, via
 * src/lib/prix-article.ts : un article en francs est converti au taux du jour) ; à défaut (ligne
 * construite sans elle), prix USD × quantité comme avant. null (sans prix, ou franc sans taux) = 0
 * dans les SOMMES seulement — la case, elle, affiche « — ».
 */
const valeurStock = (a: { prix: string | null; quantite: string; valeurUSD?: number | null }) =>
  a.valeurUSD !== undefined ? a.valeurUSD ?? 0 : (Number(a.prix) || 0) * (Number(a.quantite) || 0);
/** « ≈ » devant une valeur (ou une somme) qui contient un article en francs converti au taux du jour. */
const approx = (rows: readonly ArticleRow[]) => (rows.some((a) => a.valeurApprox) ? "≈ " : "");
/** Articles en francs NON valorisés (taux du jour absent) : la somme le dit au lieu de les compter 0. */
const horsSansTaux = (rows: readonly ArticleRow[]) => { const n = rows.filter((a) => a.devisePrix === "CDF" && a.prixCDF && a.valeurUSD === null).length; return n ? ` (hors ${n} article${n > 1 ? "s" : ""} en FC : taux non défini)` : ""; };
/** Valeur d'UN article affichée : « — » sans prix (ou franc sans taux), « ≈ » pour un article en francs. */
const texteValeur = (a: ArticleRow) => (a.valeurUSD === null ? "—" : `${a.valeurApprox ? "≈ " : ""}${usd(valeurStock(a))}`);
/** Prix dans sa devise de saisie : le champ que la case modifie, la valeur et l'autre devise « ≈ ». */
const prixDe = (a: ArticleRow) => a.devisePrix === "CDF"
  ? { champ: "prixUnitaireCDF", valeur: nombreDeBase(a.prixCDF ?? null), symbole: "FC" }
  : { champ: "prixUnitaireUSD", valeur: nombreDeBase(a.prix), symbole: "$" };

export type Domaine = "NOURRITURE" | "BOISSON" | "AUTRE";
export type ArticleRow = {
  id: string;
  code: string | null; // code article (repris du fichier d'inventaire)
  designation: string;
  /** Nom court imprimé sur la fiche « Commande journalière ». */
  nomCourt?: string | null;
  /** Coché « Sur la fiche commande ». */
  surFicheCommande?: boolean;
  domaine: Domaine;
  categorieId: string | null;
  fournisseurId: string | null;
  unite: string | null;
  /** Prix de référence en dollars (article en $) ; null pour un article en francs. */
  prix: string | null;
  /** Devise de saisie du prix (absente = $) et prix en francs (article en FC). */
  devisePrix?: "USD" | "CDF";
  prixCDF?: string | null;
  /** L'autre devise au taux du jour (« ≈ 7 000 FC »), calculée par le serveur ; null = sans prix. */
  prixAutre?: string | null;
  /** Prix en dollars (exact, ou « ≈ » au taux du jour pour un article en FC) : sert au tri. */
  prixEnUSD?: number | null;
  /** Valeur du stock en dollars (null = sans prix, ou franc sans taux) ; « ≈ » si l'article est en francs. */
  valeurUSD?: number | null;
  valeurApprox?: boolean;
  uniteParCarton: string | null; // conditionnement : nb d'unités par carton
  quantite: string;
  stockMinimum: string;
  niveau: NiveauAlerte | null;
  haussePct?: number | null; // % de hausse du dernier prix d'achat vs moyenne précédente (si anormale)
  /** Une proposition de modification attend la décision de la Direction (« Demandes à valider »). */
  propositionEnAttente?: boolean;
};
type Cat = { id: string; nom: string; domaine: string };
type Four = { id: string; nom: string };

type TriCol = "code" | "designation" | "categorie" | "fournisseur" | "stock" | "valeur" | "prix" | "min" | "alerte";
const ORDRE_ALERTE: Record<string, number> = { URGENT: 0, APPRO: 1, OK: 2 };
const valeurTri = (a: ArticleRow, col: TriCol, catNom: Map<string, string>, fourNom: Map<string, string>): string | number =>
  col === "code" ? (a.code && Number.isFinite(Number(a.code)) ? Number(a.code) : a.code ? Number.MAX_SAFE_INTEGER : Number.POSITIVE_INFINITY) : // codes numériques triés en nombre, vides en dernier
  col === "designation" ? a.designation.toLowerCase() :
  col === "categorie" ? (a.categorieId ? catNom.get(a.categorieId) ?? "" : "￿").toLowerCase() :
  col === "fournisseur" ? (a.fournisseurId ? fourNom.get(a.fournisseurId) ?? "" : "￿").toLowerCase() :
  col === "stock" ? Number(a.quantite) || 0 :
  col === "valeur" ? valeurStock(a) :
  col === "prix" ? (a.devisePrix === "CDF" ? a.prixEnUSD ?? 0 : Number(a.prix) || 0) : // un prix en FC se trie à son équivalent du jour
  col === "min" ? Number(a.stockMinimum) || 0 :
  col === "alerte" ? (a.niveau ? ORDRE_ALERTE[a.niveau] : 3) : 0;

type ManqueKey = "" | "prix" | "fournisseur" | "seuil" | "unite" | "negatif";
// Détecte un champ manquant (pur, hors composant → pas de dépendance de hook).
const manqueDe = (a: ArticleRow, m: ManqueKey) =>
  m === "prix" ? (a.devisePrix === "CDF" ? !a.prixCDF || Number(a.prixCDF) === 0 : !a.prix || Number(a.prix) === 0) :
  m === "fournisseur" ? !a.fournisseurId :
  m === "seuil" ? !a.stockMinimum || Number(a.stockMinimum) <= 0 :
  m === "unite" ? !a.unite || !a.unite.trim() :
  m === "negatif" ? Number(a.quantite) < 0 : false;

/** Pilule tactile de la rangée de filtres du téléphone (36 px de haut, jamais coupée sur deux lignes). */
const PILULE_MOBILE = "inline-flex min-h-9 shrink-0 items-center whitespace-nowrap rounded-full border px-3 text-sm";
const cellCls = "w-full rounded border border-input bg-background px-1.5 py-1 text-xs";
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/** Tris proposés sur téléphone (même `tri` que les en-têtes de l'ordinateur) : valeur = « colonne:sens ». */
const TRIS_MOBILE: readonly (readonly [string, string])[] = [
  ["", "↕ Catégories"],
  ["stock:1", "↕ Stock bas"],
  ["stock:-1", "↕ Stock haut"],
  ["alerte:1", "↕ Alertes"],
  ["designation:1", "↕ Nom A-Z"],
];
const ALERTES = [["", "Toutes"], ["URGENT", "Urgent"], ["APPRO", "À réappro."], ["OK", "Satisfaisant"]] as const;

export function CatalogueTable({ articles, categories, fournisseurs, lockedDomaine, initialQ, initialAlerte, pageInit = 1, parInit = 50, actionsPlus, estDirection = true }: {
  articles: ArticleRow[]; categories: Cat[]; fournisseurs: Four[]; lockedDomaine?: Domaine; initialQ?: string; initialAlerte?: NiveauAlerte;
  /** Page et taille de page de l'URL (50 par défaut) : tout est chargé ici, la page est une tranche du filtre. */
  pageInit?: number; parInit?: ParPage;
  /**
   * Direction : les cases s'enregistrent tout de suite. Autre compte : l'Inventaire est en LECTURE
   * (une modification se PROPOSE depuis la fiche article), et les actions groupées créent une
   * proposition — règle de Sacha du 2026-09-30.
   */
  estDirection?: boolean;
  /** Téléphone : boutons de l'en-tête de page (Exporter…) rangés dans le menu « Plus » du bloc du haut. */
  actionsPlus?: ReactNode;
}) {
  const [isPending, startTransition] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null); // proposition envoyée à la Direction
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [bulkCat, setBulkCat] = useState("");
  const [fusionKeep, setFusionKeep] = useState<string | null>(null); // article à conserver (panneau de fusion ouvert)
  const [ajout, setAjout] = useState(false);
  const [deviseAjout, setDeviseAjout] = useState<"USD" | "CDF">("USD"); // devise du prix d'un nouvel article
  const [plus, setPlus] = useState(false); // téléphone : menu « Plus » (À compléter, valeur du stock, ajout, export)
  const [q, setQ] = useState(initialQ ?? "");
  const dom: "TOUS" | Domaine = lockedDomaine ?? "TOUS"; // choisi par les pilules d'en-tête (?domaine=)
  const [alerte, setAlerte] = useState<"" | NiveauAlerte>(initialAlerte ?? "");
  const [manque, setManque] = useState<ManqueKey>(""); // vue « À compléter »
  const [hausseSeule, setHausseSeule] = useState(false); // filtre : articles dont le prix d'achat a grimpé
  const [bulkFour, setBulkFour] = useState("");
  const [bulkSeuil, setBulkSeuil] = useState("");
  // Seuil en masse lu à la française (« 2,5 ») ; null = vide ou illisible → bouton inactif.
  const seuilEnMasse = (() => { const l = lireSaisieNombre(bulkSeuil); return l.ok && l.valeur !== null && l.valeur >= 0 ? l.valeur : null; })();
  const [tri, setTri] = useState<{ col: TriCol; dir: 1 | -1 } | null>(null); // null = groupé par catégorie

  const catNom = useMemo(() => new Map(categories.map((c) => [c.id, c.nom])), [categories]);
  const fourNom = useMemo(() => new Map(fournisseurs.map((f) => [f.id, f.nom])), [fournisseurs]);
  // Une liste d'options pour TOUS les fournisseurs du tableau (lignes, cartes, action groupée, ajout) : on y cherche en tapant.
  const optionsFour = useMemo(() => optionsFournisseurs(fournisseurs), [fournisseurs]);

  // Clic sur un en-tête : croissant → décroissant → retour au groupement par catégorie.
  const trierPar = (col: TriCol) =>
    setTri((t) => (t?.col !== col ? { col, dir: 1 } : t.dir === 1 ? { col, dir: -1 } : null));

  const visibles = useMemo(() => {
    const nq = norm(q.trim());
    return articles.filter((a) =>
      (dom === "TOUS" || a.domaine === dom) &&
      (!alerte || a.niveau === alerte) &&
      (!manque || manqueDe(a, manque)) &&
      (!hausseSeule || a.haussePct != null) &&
      (!nq || norm(a.designation).includes(nq) || (a.code ?? "").toLowerCase().includes(nq)),
    );
  }, [articles, q, dom, alerte, manque, hausseSeule]);

  // Liste affichée : triée par colonne si un tri est actif, sinon ordre d'origine (groupé par catégorie).
  const affichees = useMemo(() => {
    if (!tri) return visibles;
    return [...visibles].sort((a, b) => {
      const x = valeurTri(a, tri.col, catNom, fourNom), y = valeurTri(b, tri.col, catNom, fourNom);
      return (x < y ? -1 : x > y ? 1 : 0) * tri.dir;
    });
  }, [visibles, tri, catNom, fourNom]);

  // Pagination (50 / 100 / Tout) : une TRANCHE de la liste filtrée et triée. Les totaux (valeur du stock,
  // compteurs de catégorie, « Remettre à 0 », sélection du filtre) restent ceux de TOUT le filtre.
  // Un autre filtre, une autre recherche ou un autre tri ramène à la page 1.
  const pagination = usePagination({ total: affichees.length, pageInit, parInit, cleFiltre: [q, dom, alerte, manque, hausseSeule, tri?.col, tri?.dir].join("|") });
  const { debut: debutPage, fin: finPage } = pagination;
  const page = useMemo(() => tranche(affichees, { debut: debutPage, fin: finPage }), [affichees, debutPage, finPage]);

  // Compteurs « À compléter » (sur le domaine courant) — dette de saisie qui bride alertes/valorisation.
  const incomplets = useMemo(() => {
    const base = articles.filter((a) => dom === "TOUS" || a.domaine === dom);
    return {
      prix: base.filter((a) => manqueDe(a, "prix")).length,
      fournisseur: base.filter((a) => manqueDe(a, "fournisseur")).length,
      seuil: base.filter((a) => manqueDe(a, "seuil")).length,
      unite: base.filter((a) => manqueDe(a, "unite")).length,
      negatif: base.filter((a) => manqueDe(a, "negatif")).length,
    };
  }, [articles, dom]);

  // Puces « À compléter » (celles qui ont au moins un article) : le bandeau de l'ordinateur et le menu « Plus » du téléphone.
  const manquants = ([
    ["seuil", incomplets.seuil, "sans seuil (jamais d'alerte)"],
    ["fournisseur", incomplets.fournisseur, "sans fournisseur"],
    ["prix", incomplets.prix, "sans prix"],
    ["unite", incomplets.unite, "sans unité"],
    ["negatif", incomplets.negatif, "stock négatif"],
  ] as const).filter(([, n]) => n > 0);
  const totalManquants = manquants.reduce((t, [, n]) => t + n, 0);

  // Nombre d'articles dont le dernier prix d'achat a grimpé (sur le domaine courant).
  const compteHausse = useMemo(
    () => articles.filter((a) => (dom === "TOUS" || a.domaine === dom) && a.haussePct != null).length,
    [articles, dom],
  );

  // Compteurs d'alerte (sur le domaine courant) pour le bandeau de réapprovisionnement.
  const compte = useMemo(() => {
    let urgent = 0, appro = 0;
    for (const a of articles) {
      if (dom !== "TOUS" && a.domaine !== dom) continue;
      if (a.niveau === "URGENT") urgent++;
      else if (a.niveau === "APPRO") appro++;
    }
    return { urgent, appro };
  }, [articles, dom]);

  // Le résultat de l'action est RENDU par `fn` : une erreur s'affiche, une proposition envoyée à la
  // Direction aussi (en information) — jamais avalés.
  const run = (fn: () => Promise<unknown>) => {
    setErreur(null); setInfo(null);
    startTransition(async () => {
      const r = await fn();
      if (estErreur(r)) setErreur(r.erreur);
      else if (r && typeof r === "object" && "proposition" in r && "message" in r) setInfo(String((r as { message: string }).message));
    });
  };
  // Stable (useCallback) : les lignes mémoïsées ne se re-rendent plus à chaque rendu du tableau.
  // Renvoie le résultat : une case numérique affiche elle-même l'échec en rouge.
  const save = useCallback(async (id: string, name: string, value: string) => {
    const fd = new FormData(); fd.set(name, value);
    const r = await modifierArticle(id, fd);
    if (estErreur(r)) setErreur(r.erreur);
    return r;
  }, []);
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  // Téléphone : un seul article déplié à la fois (ses champs éditables), un nouvel appui le replie.
  const [ouvert, setOuvert] = useState<string | null>(null);
  const basculerOuvert = useCallback((id: string) => setOuvert((o) => (o === id ? null : id)), []);
  // « Tout sélectionner » coche la PAGE affichée ; « Sélectionner les N du filtre » (barre d'actions) coche tout le filtre.
  // Les actions groupées reçoivent des listes d'identifiants, comme avant : rien de nouveau côté serveur.
  const toutSel = (on: boolean) => setSel((s) => { const n = new Set(s); for (const a of page) { if (on) n.add(a.id); else n.delete(a.id); } return n; });
  const pageToutCochee = page.length > 0 && page.every((a) => sel.has(a.id));
  const nbFiltreCoches = visibles.reduce((t, a) => t + (sel.has(a.id) ? 1 : 0), 0);
  const filtreDepasseLaPage = visibles.length > page.length;

  return (
    <div className="space-y-2 lg:space-y-3">
      {erreur && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erreur}</p>}
      {info && <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">{info} <Link href="/stock/a-valider" className="font-medium underline">Voir mes demandes</Link></p>}
      {!estDirection && (
        <p className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          Les modifications d&apos;articles sont validées par la Direction : ouvrez la fiche d&apos;un article (↗) pour en proposer une. Les actions groupées envoient, elles aussi, une proposition.
        </p>
      )}

      {/* Bandeau réapprovisionnement : visible en permanence dès qu'un article est bas ; clic = filtre. Sur téléphone, ces deux bandeaux (et « À compléter ») deviennent des pilules à compteur dans la rangée défilante plus bas : la même information, sans la place. */}
      {(compte.urgent > 0 || compte.appro > 0) && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm max-lg:hidden">
          <span className="font-semibold text-amber-900">⚠ À réapprovisionner</span>
          {compte.urgent > 0 && (
            <button
              onClick={() => setAlerte(alerte === "URGENT" ? "" : "URGENT")}
              className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${ALERTE_CLASSE.URGENT} ${alerte === "URGENT" ? "ring-2 ring-red-400" : ""}`}
            >
              {compte.urgent} urgent{compte.urgent > 1 ? "s" : ""}
            </button>
          )}
          {compte.appro > 0 && (
            <button
              onClick={() => setAlerte(alerte === "APPRO" ? "" : "APPRO")}
              className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${ALERTE_CLASSE.APPRO} ${alerte === "APPRO" ? "ring-2 ring-amber-400" : ""}`}
            >
              {compte.appro} à réappro.
            </button>
          )}
          {alerte && <button onClick={() => setAlerte("")} className="ml-auto text-xs text-muted-foreground underline">Voir tout</button>}
        </div>
      )}

      {/* Hausse de prix : articles rachetés nettement plus cher que la moyenne précédente. Clic = filtre. */}
      {compteHausse > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-red-300 bg-red-50 px-3 py-2.5 text-sm max-lg:hidden">
          <span className="font-semibold text-red-800">📈 Hausse de prix d&apos;achat</span>
          <button
            onClick={() => setHausseSeule((v) => !v)}
            className={`rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-800 ${hausseSeule ? "ring-2 ring-red-400" : ""}`}
          >
            {compteHausse} article{compteHausse > 1 ? "s" : ""}
          </button>
          {hausseSeule && <button onClick={() => setHausseSeule(false)} className="ml-auto text-xs text-muted-foreground underline">Voir tout</button>}
        </div>
      )}

      <div className="flex items-center gap-2 lg:flex-wrap">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher…" aria-label="Rechercher un article" className="w-full max-w-xs rounded-md border border-input bg-background px-3 py-1.5 text-sm max-lg:min-h-11 max-lg:min-w-0 max-lg:flex-[1.15]" />
        {/* Téléphone : le tri des en-têtes de colonne n'existe pas — même état `tri` que l'ordinateur, choisi par une liste. */}
        <label className="flex min-w-0 flex-1 text-sm lg:hidden">
          <select
            value={tri ? `${tri.col}:${tri.dir}` : ""}
            onChange={(e) => {
              const [col, dir] = e.target.value.split(":");
              setTri(col ? { col: col as TriCol, dir: dir === "-1" ? -1 : 1 } : null);
            }}
            className="min-h-11 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm"
            aria-label="Trier les articles"
          >
            {TRIS_MOBILE.map(([valeur, label]) => <option key={valeur} value={valeur}>{label}</option>)}
          </select>
        </label>
        {/* Le domaine se choisit via les pilules d'en-tête (Tous / Nourriture / Boissons / Autre). */}
        <div className="flex gap-1.5 text-sm max-lg:hidden">
          {ALERTES.map(([k, label]) => (
            <button key={k} onClick={() => setAlerte(k as "" | NiveauAlerte)} className={`rounded-full border px-3 py-1 ${alerte === k ? "border-primary bg-primary/10 font-medium" : "hover:bg-accent"}`}>{label}</button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground max-lg:hidden">{visibles.length} / {articles.length} article(s)</span>
        {/* Téléphone : « Plus » range ce qui est secondaire (à compléter, valeur du stock, ajout, export). */}
        <button
          type="button"
          onClick={() => setPlus((v) => !v)}
          aria-expanded={plus}
          aria-controls="inventaire-plus"
          aria-label={totalManquants > 0 ? `Plus d'options — ${totalManquants} à compléter` : "Plus d'options"}
          className={`relative inline-flex min-h-11 shrink-0 items-center gap-1 rounded-md border px-3 text-sm font-medium lg:hidden ${plus ? "border-primary bg-primary/10" : ""}`}
        >
          Plus <span aria-hidden className="text-[10px]">{plus ? "▲" : "▼"}</span>
          {totalManquants > 0 && <span aria-hidden className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-amber-500" />}
        </button>
      </div>

      {/* Téléphone : UNE rangée de pilules qui défile de côté (au lieu de plusieurs lignes empilées).
          Les compteurs reprennent les bandeaux « À réapprovisionner » et « Hausse de prix » ; chaque pilule filtre. */}
      <div data-filtres-mobile="" role="group" aria-label="Filtres" className="-mx-4 flex gap-1.5 overflow-x-auto px-4 lg:hidden">
        {ALERTES.map(([k, label]) => {
          const n = k === "URGENT" ? compte.urgent : k === "APPRO" ? compte.appro : 0;
          return (
            <button
              key={k}
              type="button"
              onClick={() => setAlerte(k as "" | NiveauAlerte)}
              aria-pressed={alerte === k}
              className={`${PILULE_MOBILE} ${n > 0 ? `border-transparent ${ALERTE_CLASSE[k as NiveauAlerte]}` : ""} ${alerte === k ? "font-semibold ring-2 ring-inset ring-primary" : ""}`}
            >
              {label}{n > 0 && <span className="ml-1 font-semibold tabular-nums">{n}</span>}
            </button>
          );
        })}
        {compteHausse > 0 && (
          <button type="button" onClick={() => setHausseSeule((v) => !v)} aria-pressed={hausseSeule} className={`${PILULE_MOBILE} border-transparent bg-red-100 text-red-800 ${hausseSeule ? "font-semibold ring-2 ring-inset ring-primary" : ""}`}>
            📈 Hausse de prix<span className="ml-1 font-semibold tabular-nums">{compteHausse}</span>
          </button>
        )}
        {manque && (
          <button type="button" onClick={() => setManque("")} aria-label="Retirer le filtre « À compléter »" className={`${PILULE_MOBILE} border-primary bg-primary/10 font-medium`}>
            À compléter : {manquants.find(([k]) => k === manque)?.[2] ?? manque} <span aria-hidden className="ml-1">✕</span>
          </button>
        )}
      </div>

      {plus && (
        <div id="inventaire-plus" data-plus-mobile="" className="space-y-3 rounded-xl border bg-muted/30 p-3 text-sm lg:hidden">
          <p className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span><span className="text-muted-foreground">Valeur du stock&nbsp;: </span><span className="font-semibold tabular-nums">{approx(articles)}{usd(articles.reduce((t, a) => t + valeurStock(a), 0))}{horsSansTaux(articles)}</span></span>
            <span className="text-xs text-muted-foreground">{visibles.length} / {articles.length} article(s)</span>
          </p>
          {manquants.length > 0 && (
            <div>
              <p className="mb-1.5 font-medium text-muted-foreground">À compléter</p>
              <div className="flex flex-wrap gap-1.5">
                {manquants.map(([k, n, lbl]) => (
                  <button key={k} type="button" onClick={() => { setManque(manque === k ? "" : k); setPlus(false); }} aria-pressed={manque === k}
                    className={`${PILULE_MOBILE} ${manque === k ? "border-primary bg-primary/10 font-medium" : ""} ${k === "negatif" ? "text-red-700" : ""}`}>
                    {n} {lbl}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => { setAjout((v) => !v); setPlus(false); }} className="min-h-11 rounded-md border bg-background px-3 font-medium hover:bg-accent">{ajout ? "Fermer l'ajout" : "+ Ajouter un article"}</button>
            {actionsPlus}
          </div>
        </div>
      )}

      {/* À compléter : champs manquants qui brident les alertes et la valorisation. Clic = filtre. */}
      {totalManquants > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-muted/40 px-3 py-2 text-sm max-lg:hidden">
          <span className="font-medium text-muted-foreground">À compléter :</span>
          {manquants.map(([k, n, lbl]) => (
            <button key={k} onClick={() => setManque(manque === k ? "" : k)}
              className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${manque === k ? "border-primary bg-primary/10" : "hover:bg-accent"} ${k === "negatif" ? "text-red-700" : ""}`}>
              {n} {lbl}
            </button>
          ))}
          {manque && <button onClick={() => setManque("")} className="ml-auto text-xs text-muted-foreground underline">Voir tout</button>}
        </div>
      )}

      {/* Correction rapide : le filtre « stock négatif » est actif → remise à 0 en un clic (ajustement tracé). */}
      {manque === "negatif" && visibles.length > 0 && estDirection && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm">
          <span className="font-medium text-red-800">{visibles.length} article(s) en stock négatif</span>
          <span className="text-xs text-red-700/80">Un mouvement d&apos;ajustement (entrée) sera créé pour revenir à 0.</span>
          <button
            disabled={isPending}
            onClick={() => run(async () => { const r = await corrigerStocksNegatifs(visibles.map((a) => a.id)); if (!estErreur(r)) setManque(""); return r; })}
            className="ml-auto rounded-md bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            Remettre à 0
          </button>
        </div>
      )}

      {sel.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
          <span className="font-medium">{sel.size} sélectionné(s)</span>
          {filtreDepasseLaPage && pageToutCochee && nbFiltreCoches < visibles.length && (
            <button type="button" data-tout-le-filtre="proposer" onClick={() => setSel(new Set(visibles.map((a) => a.id)))} className="text-xs font-medium text-primary underline">
              Sélectionner les {visibles.length} articles du filtre
            </button>
          )}
          {filtreDepasseLaPage && nbFiltreCoches === visibles.length && <span data-tout-le-filtre="actif" className="text-xs text-muted-foreground">tout le filtre ({visibles.length}) est sélectionné</span>}
          <span className="text-muted-foreground">→ catégoriser :</span>
          <select value={bulkCat} onChange={(e) => setBulkCat(e.target.value)} className="rounded border border-input bg-background px-2 py-1 text-xs">
            <option value="">Choisir une catégorie…</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.nom} ({(DOMAINE_LABEL[c.domaine] ?? "?")[0]})</option>)}
          </select>
          <button disabled={isPending || !bulkCat} onClick={() => run(async () => { const r = await categoriserEnMasse([...sel], bulkCat); if (!estErreur(r)) { setSel(new Set()); setBulkCat(""); } return r; })} className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50">{estDirection ? "Appliquer" : "Proposer"}</button>
          <span className="text-muted-foreground">· fournisseur :</span>
          <ChoixRecherche options={optionsFour} value={bulkFour} vide="Choisir un fournisseur…" onChange={setBulkFour} aria-label="Fournisseur de l'action groupée" className="w-52 rounded border border-input bg-background px-2 py-1 text-xs" />
          <button disabled={isPending || !bulkFour} onClick={() => run(async () => { const r = await definirFournisseurEnMasse([...sel], bulkFour); if (!estErreur(r)) { setSel(new Set()); setBulkFour(""); } return r; })} className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50">{estDirection ? "Appliquer" : "Proposer"}</button>
          <span className="text-muted-foreground">· seuil min :</span>
          <input type="text" inputMode="decimal" autoComplete="off" value={bulkSeuil} onChange={(e) => setBulkSeuil(e.target.value)} placeholder="ex. 4" aria-invalid={seuilEnMasse === null && bulkSeuil.trim() !== "" ? true : undefined} className="w-16 rounded border border-input bg-background px-2 py-1 text-xs aria-[invalid=true]:border-destructive" />
          <button disabled={isPending || seuilEnMasse === null} onClick={() => run(async () => { const r = await definirSeuilEnMasse([...sel], seuilEnMasse!); if (!estErreur(r)) { setSel(new Set()); setBulkSeuil(""); } return r; })} className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground disabled:opacity-50">{estDirection ? "Appliquer" : "Proposer"}</button>
          <button disabled={isPending} onClick={() => run(async () => { const r = await basculerActifArticles([...sel], true); if (!estErreur(r)) setSel(new Set()); return r; })} className="rounded-md border border-emerald-300 px-3 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-50 disabled:opacity-50">{estDirection ? "Activer" : "Proposer l'activation"}</button>
          <button disabled={isPending} onClick={() => run(async () => { const r = await basculerActifArticles([...sel], false); if (!estErreur(r)) setSel(new Set()); return r; })} className="rounded-md border px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-accent disabled:opacity-50">{estDirection ? "Désactiver" : "Proposer la désactivation"}</button>
          <button disabled={isPending} onClick={() => run(async () => { const r = await basculerFicheCommande([...sel], true); if (!estErreur(r)) setSel(new Set()); return r; })} className="rounded-md border border-primary/40 px-3 py-1 text-xs font-medium hover:bg-primary/10 disabled:opacity-50">Mettre sur la fiche commande</button>
          <button disabled={isPending} onClick={() => run(async () => { const r = await basculerFicheCommande([...sel], false); if (!estErreur(r)) setSel(new Set()); return r; })} className="rounded-md border px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-accent disabled:opacity-50">Retirer de la fiche commande</button>
          <button onClick={() => setSel(new Set())} className="text-xs text-muted-foreground underline">Annuler</button>
          {sel.size >= 2 && estDirection && (
            <button disabled={isPending} onClick={() => setFusionKeep([...sel][0])} className="ml-auto rounded-md border border-amber-400 px-3 py-1 text-xs font-medium text-amber-800 hover:bg-amber-50 disabled:opacity-50">Fusionner en 1…</button>
          )}
        </div>
      )}

      {/* Panneau de fusion : choix explicite de l'article à CONSERVER ; les autres sont supprimés. */}
      {fusionKeep && sel.size >= 2 && estDirection && (() => {
        const selectionnes = articles.filter((a) => sel.has(a.id));
        const keepOk = selectionnes.some((a) => a.id === fusionKeep) ? fusionKeep : selectionnes[0]?.id;
        return (
          <div className="rounded-lg border border-amber-300 bg-amber-50/60 p-3 text-sm">
            <p className="mb-2 font-medium text-amber-900">Fusionner {selectionnes.length} articles — lequel <span className="underline">conserver</span> ?</p>
            <p className="mb-2 text-xs text-amber-800">L&apos;article conservé récupère le stock, les mouvements, bons de commande et factures des autres. Les autres sont <strong>supprimés définitivement</strong>.</p>
            <ul className="mb-3 space-y-1">
              {selectionnes.map((a) => (
                <li key={a.id}>
                  <label className={`flex cursor-pointer items-center gap-2 rounded-md border px-2 py-1.5 ${keepOk === a.id ? "border-amber-400 bg-amber-100" : "bg-background hover:bg-accent"}`}>
                    <input type="radio" name="fusion-keep" checked={keepOk === a.id} onChange={() => setFusionKeep(a.id)} />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{a.code ? `${a.code} · ` : ""}{a.designation}</span>
                      <span className="ml-2 text-xs text-muted-foreground">stock {a.quantite}{a.categorieId ? " · catégorisé" : " · sans catégorie"}{a.devisePrix === "CDF" ? (a.prixCDF ? ` · ${formaterFC(Number(a.prixCDF))}` : "") : a.prix ? ` · ${usd(Number(a.prix))}` : ""}</span>
                    </span>
                    {keepOk === a.id && <span className="shrink-0 rounded-full bg-amber-200 px-2 py-0.5 text-[11px] font-medium text-amber-900">à conserver</span>}
                  </label>
                </li>
              ))}
            </ul>
            <div className="flex items-center gap-2">
              <button disabled={isPending || !keepOk} onClick={() => run(async () => { const r = await fusionnerArticles([...sel], keepOk); if (!estErreur(r)) { setSel(new Set()); setFusionKeep(null); } return r; })} className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50">Fusionner ({selectionnes.length - 1} supprimé{selectionnes.length - 1 > 1 ? "s" : ""})</button>
              <button onClick={() => setFusionKeep(null)} className="text-xs text-muted-foreground underline">Annuler</button>
            </div>
          </div>
        );
      })()}

      <div className="flex items-center justify-between max-lg:hidden">
        <button onClick={() => setAjout((v) => !v)} className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">{ajout ? "Fermer" : "+ Ajouter un article"}</button>
      </div>

      {ajout && (
        <form action={(fd) => run(async () => { const r = await creerArticle(fd); if (!estErreur(r)) setAjout(false); return r; })} className="grid grid-cols-2 gap-2 rounded-lg border p-3 text-sm md:grid-cols-4">
          <input name="designation" placeholder="Désignation *" required className={cellCls} />
          <select name="domaine" defaultValue={lockedDomaine ?? "NOURRITURE"} className={cellCls}>
            <option value="NOURRITURE">Nourriture</option>
            <option value="BOISSON">Boisson</option>
            <option value="AUTRE">Autre</option>
          </select>
          <select name="categorieId" defaultValue="" className={cellCls}>
            <option value="">— catégorie —</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.nom} ({(DOMAINE_LABEL[c.domaine] ?? "?")[0]})</option>)}
          </select>
          <ChoixRecherche options={optionsFour} name="fournisseurId" defaultValue="" vide="— fournisseur —" aria-label="Fournisseur du nouvel article" className={cellCls} />
          <input name="code" placeholder="Code article (ex. 137)" className={cellCls} />
          <input name="unite" placeholder="Unité (Kg, Pièce…)" className={cellCls} />
          <div className="flex gap-1">
            {/* Prix de référence dans la devise choisie ($ ou FC) : c'est elle qui fera foi. */}
            <input name={deviseAjout === "CDF" ? "prixUnitaireCDF" : "prixUnitaireUSD"} type="text" inputMode="decimal" pattern={MOTIF_HTML_DECIMAL_POSITIF} title="Nombre, ex. 2,5" placeholder={deviseAjout === "CDF" ? "Prix FC" : "Prix USD"} className={`${cellCls} min-w-0 flex-1`} />
            <input type="hidden" name="devisePrix" value={deviseAjout} />
            {/* Même bascule $ / FC que la fiche article et le paiement des factures. */}
            <div role="group" aria-label="Devise du prix" className="inline-flex shrink-0 overflow-hidden rounded border text-xs">
              <button type="button" onClick={() => setDeviseAjout("USD")} aria-pressed={deviseAjout === "USD"} className={`px-2 ${deviseAjout === "USD" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>$</button>
              <button type="button" onClick={() => setDeviseAjout("CDF")} aria-pressed={deviseAjout === "CDF"} className={`px-2 ${deviseAjout === "CDF" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>FC</button>
            </div>
          </div>
          <input name="uniteParCarton" type="text" inputMode="decimal" pattern={MOTIF_HTML_DECIMAL_POSITIF} title="Nombre, ex. 2,5" placeholder="Unités / carton (ex. 24)" className={cellCls} />
          {/* Stock initial : Direction seulement (ailleurs, il entre par la Liste d'achat ou un comptage). */}
          {estDirection && <input name="quantite" type="text" inputMode="decimal" pattern={MOTIF_HTML_DECIMAL_POSITIF} title="Nombre, ex. 2,5" placeholder="Stock initial" className={cellCls} />}
          <input name="stockMinimum" type="text" inputMode="decimal" pattern={MOTIF_HTML_DECIMAL_POSITIF} title="Nombre, ex. 2,5" placeholder="Stock minimum" className={cellCls} />
          <button disabled={isPending} className="col-span-2 rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground disabled:opacity-50 md:col-span-4">Créer l&apos;article</button>
        </form>
      )}

      <ZoneTableur>
      {/* Mobile : une rangée compacte par article (stock en gros), groupée par catégorie ; un appui déplie les champs éditables. */}
      <div data-tableur="" data-tableur-tab="natif" data-vue="rangees-mobile" className="space-y-1.5 lg:hidden">
        {page.map((a, i) => (
          <Fragment key={a.id}>
            {!tri && (i === 0 || page[i - 1].categorieId !== a.categorieId) && (
              <div className="px-1 pt-2 text-sm font-semibold text-amber-900">
                {a.categorieId ? catNom.get(a.categorieId) ?? "Catégorie" : "À classer"} ({visibles.filter((x) => x.categorieId === a.categorieId).length})
              </div>
            )}
            <CarteArticle
              a={a} categories={categories} optionsFour={optionsFour} selected={sel.has(a.id)} onToggle={toggle} onSave={save} lectureSeule={!estDirection}
              ouvert={ouvert === a.id} onOuvrir={basculerOuvert}
              categorieNom={tri && a.categorieId ? catNom.get(a.categorieId) ?? null : null}
            />
          </Fragment>
        ))}
        {visibles.length === 0 && <EtatVide message="Aucun article." />}
      </div>

      {/* Ordinateur — tableur : cellules éditables. Tableau « normal » : la page défile ; 13 colonnes ≥ 1085 px, donc défilement de côté seul (pas d'en-tête collant : un overflow-x le casse). */}
      <div className="hidden overflow-x-auto rounded-lg border lg:block">
        {/* Tableur : Entrée descend dans la colonne ; Tab reste celui du navigateur (champs texte et listes dans la ligne). */}
        <table data-tableur="" data-tableur-tab="natif" className="w-full min-w-[60rem] border-separate border-spacing-0 text-sm">
          <thead className="bg-muted text-left shadow-sm">
            <tr className="[&>th]:border-b [&>th]:px-2 [&>th]:py-2 [&>th]:font-semibold">
              <th className="w-8"><input type="checkbox" checked={pageToutCochee} ref={(el) => { if (el) el.indeterminate = !pageToutCochee && page.some((a) => sel.has(a.id)); }} onChange={(e) => toutSel(e.target.checked)} aria-label={`Tout sélectionner (${page.length} de cette page)`} title="Sélectionne les articles de cette page" /></th>
              <ThTri col="code" tri={tri} onTri={trierPar} className="w-14">Code</ThTri>
              <ThTri col="designation" tri={tri} onTri={trierPar}>Désignation</ThTri>
              <th className="w-40" title="Nom imprimé sur la fiche Commande journalière">Nom court</th>
              <ThTri col="stock" tri={tri} onTri={trierPar} align="right" className="w-16">Stock</ThTri>
              <ThTri col="alerte" tri={tri} onTri={trierPar} className="w-24">Alerte</ThTri>
              <ThTri col="min" tri={tri} onTri={trierPar} align="right" className="w-20">Min</ThTri>
              <ThTri col="categorie" tri={tri} onTri={trierPar}>Catégorie</ThTri>
              <ThTri col="fournisseur" tri={tri} onTri={trierPar}>Fournisseur</ThTri>
              <th className="w-20">Unité</th>
              <ThTri col="valeur" tri={tri} onTri={trierPar} align="right" className="w-24" title="Prix × stock">Valeur</ThTri>
              <ThTri col="prix" tri={tri} onTri={trierPar} align="right" className="w-28" title="Prix de référence dans sa devise de saisie ($ ou FC) ; l'autre devise au taux du jour">Prix</ThTri>
              <th className="w-20 text-right" title="Nombre d'unités par carton">Par carton</th>
            </tr>
          </thead>
          <tbody className="[&>tr>td]:border-b [&>tr>td]:px-2 [&>tr>td]:py-1">
            {page.map((a, i) => (
              <Fragment key={a.id}>
                {!tri && (i === 0 || page[i - 1].categorieId !== a.categorieId) && (
                  <tr>
                    <td colSpan={13} className="bg-amber-100 !py-2 text-sm font-bold uppercase tracking-wide text-amber-900">
                      {a.categorieId ? catNom.get(a.categorieId) ?? "Catégorie" : "À classer"} ({visibles.filter((x) => x.categorieId === a.categorieId).length})
                    </td>
                  </tr>
                )}
                <LigneArticle a={a} categories={categories} optionsFour={optionsFour} selected={sel.has(a.id)} onToggle={toggle} onSave={save} lectureSeule={!estDirection} />
              </Fragment>
            ))}
            {visibles.length === 0 && <tr><td colSpan={13} className="px-3 py-6 text-center text-muted-foreground">Aucun article.</td></tr>}
          </tbody>
          {visibles.length > 0 && (
            <tfoot className="bg-muted">
              <tr className="border-t-2 font-semibold [&>td]:px-2 [&>td]:py-2">
                <td colSpan={10} className="text-right">Valeur totale du stock filtré{pagination.nbPages > 1 ? ` (${affichees.length} articles, toutes les pages)` : ""}</td>
                <td className="text-right tabular-nums" title={horsSansTaux(affichees).trim() || undefined}>{approx(affichees)}{usd(affichees.reduce((t, a) => t + valeurStock(a), 0))}{horsSansTaux(affichees) ? " *" : ""}</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      </ZoneTableur>
      <Pagination total={affichees.length} page={pagination.page} par={pagination.par} onChange={pagination.aller} libelle="articles" />
    </div>
  );
}

// En-tête de colonne triable : clic = croissant → décroissant → groupé par catégorie.
function ThTri({ col, tri, onTri, align, className, title, children }: {
  col: TriCol; tri: { col: TriCol; dir: 1 | -1 } | null; onTri: (c: TriCol) => void;
  align?: "right"; className?: string; title?: string; children: ReactNode;
}) {
  const actif = tri?.col === col;
  return (
    <th className={`${className ?? ""} ${align === "right" ? "text-right" : ""}`} title={title}>
      <button
        type="button"
        onClick={() => onTri(col)}
        className={`inline-flex items-center gap-0.5 font-semibold hover:text-primary ${align === "right" ? "flex-row-reverse" : ""} ${actif ? "text-primary" : ""}`}
      >
        {children}
        <span className="w-2 text-[10px]">{actif ? (tri!.dir === 1 ? "▲" : "▼") : ""}</span>
      </button>
    </th>
  );
}

const LigneArticle = memo(function LigneArticle({
  a, categories, optionsFour, selected, onToggle, onSave, lectureSeule = false,
}: {
  a: ArticleRow; categories: Cat[]; optionsFour: OptionChoix[];
  selected: boolean; onToggle: (id: string) => void; onSave: (id: string, name: string, value: string) => Promise<unknown>;
  /** Hors Direction : cases en lecture seule (la modification se propose depuis la fiche). */
  lectureSeule?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const catsPour = categories.filter((c) => c.domaine === a.domaine);
  const write = (name: string, value: string, prev: string) => {
    if (lectureSeule || value === prev) return;
    setBusy(true);
    onSave(a.id, name, value).finally(() => setBusy(false));
  };

  return (
    <tr className={`hover:bg-accent/40 ${selected ? "bg-primary/10" : "even:bg-muted/25"} ${busy ? "opacity-60" : ""}`}>
      <td><input type="checkbox" checked={selected} onChange={() => onToggle(a.id)} /></td>
      <td><input readOnly={lectureSeule} defaultValue={a.code ?? ""} onBlur={(e) => write("code", e.target.value, a.code ?? "")} className={`${cellCls} w-14 text-center tabular-nums`} placeholder="—" title="Code article" /></td>
      <td>
        <div className="flex items-center gap-1">
          <input readOnly={lectureSeule} defaultValue={a.designation} onBlur={(e) => write("designation", e.target.value, a.designation)} className={`${cellCls} min-w-44 flex-1 font-medium`} title="Modifier le nom de l'article" />
          {a.haussePct != null && <span title={`Dernier prix d'achat +${Math.round(a.haussePct)}% vs moyenne précédente`} className="shrink-0 rounded bg-red-100 px-1 py-0.5 text-[10px] font-semibold text-red-700">📈+{Math.round(a.haussePct)}%</span>}
          {a.surFicheCommande && <span title="Sur la fiche Commande journalière" className="shrink-0 rounded bg-primary/10 px-1 py-0.5 text-[10px] font-semibold text-primary">fiche cmd</span>}
          {a.propositionEnAttente && <BadgeProposition />}
          <Link href={`/stock/catalogue/${a.id}`} title="Ouvrir la fiche article (historique, prix)" className="shrink-0 text-primary hover:text-primary/70" aria-label="Fiche article">↗</Link>
        </div>
      </td>
      <td><input readOnly={lectureSeule} defaultValue={a.nomCourt ?? ""} onBlur={(e) => write("nomCourt", e.target.value, a.nomCourt ?? "")} className={`${cellCls} w-40`} placeholder="—" title="Nom court (fiche Commande journalière)" aria-label={`Nom court — ${a.designation}`} /></td>
      <td className="text-right tabular-nums text-muted-foreground" title="Le stock ne se modifie que par la liste d'achat, la facture ou une sortie">{a.quantite}</td>
      <td>{a.niveau && <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ALERTE_CLASSE[a.niveau]}`}>{ALERTE_LABEL[a.niveau]}</span>}</td>
      <td><CelluleNombre readOnly={lectureSeule} groupe={a.categorieId ?? ""} ligne={a.id} col={0} valeur={nombreDeBase(a.stockMinimum)} onEnregistrer={(v) => onSave(a.id, "stockMinimum", texteDe(v))} min={0} quantite className={`${cellCls} text-right`} title="Seuil minimum (alerte de réappro)" aria-label={`Stock minimum — ${a.designation}`} /></td>
      <td>
        <select disabled={lectureSeule} defaultValue={a.categorieId ?? ""} onChange={(e) => write("categorieId", e.target.value, a.categorieId ?? "")} className={`${cellCls} min-w-32 ${!a.categorieId ? "border-amber-400" : ""}`}>
          <option value="">— à classer —</option>
          {catsPour.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
        </select>
      </td>
      <td>
        <div className="flex items-center gap-1">
          <ChoixRecherche disabled={lectureSeule} options={optionsFour} defaultValue={a.fournisseurId ?? ""} vide="—" onChange={(v) => write("fournisseurId", v, a.fournisseurId ?? "")} aria-label={`Fournisseur — ${a.designation}`} className={`${cellCls} min-w-28 flex-1`} />
          {a.fournisseurId && (
            <Link href={`/stock/fournisseurs/${a.fournisseurId}`} title="Ouvrir la fiche fournisseur" className="shrink-0 text-primary hover:text-primary/70" aria-label="Fiche fournisseur">↗</Link>
          )}
        </div>
      </td>
      <td><input readOnly={lectureSeule} defaultValue={a.unite ?? ""} onBlur={(e) => write("unite", e.target.value, a.unite ?? "")} className={cellCls} placeholder="—" title="Unité de mesure (Kg, Pièce, Bouteille…)" /></td>
      <td className="text-right tabular-nums text-muted-foreground">{texteValeur(a)}</td>
      <td>
        {/* Prix dans SA devise de saisie (la case modifie ce prix-là) ; l'autre devise « ≈ » au taux du jour. */}
        <div className="flex items-center gap-1">
          <CelluleNombre readOnly={lectureSeule} groupe={a.categorieId ?? ""} ligne={a.id} col={1} valeur={prixDe(a).valeur} onEnregistrer={(v) => onSave(a.id, prixDe(a).champ, texteDe(v))} min={0} className={`${cellCls} text-right`} aria-label={`Prix ${prixDe(a).symbole} — ${a.designation}`} />
          <span className="w-5 shrink-0 text-[11px] text-muted-foreground">{prixDe(a).symbole}</span>
        </div>
        {a.prixAutre && <span className="block text-right text-[10px] tabular-nums text-muted-foreground">{a.prixAutre}</span>}
      </td>
      <td><CelluleNombre readOnly={lectureSeule} groupe={a.categorieId ?? ""} ligne={a.id} col={2} valeur={nombreDeBase(a.uniteParCarton)} onEnregistrer={(v) => onSave(a.id, "uniteParCarton", texteDe(v))} min={0} quantite className={`${cellCls} text-right`} placeholder="—" title="Nombre d'unités par carton (ex. 24)" aria-label={`Unités par carton — ${a.designation}`} /></td>
    </tr>
  );
});

const champLabel = "flex flex-col gap-0.5 text-[11px] font-medium text-muted-foreground";

/**
 * Façon dont la rangée mobile montre le stock d'un article. AUCUNE règle nouvelle : la couleur suit
 * le niveau d'alerte déjà calculé côté serveur (`niveauAlerte` : URGENT = rupture avec seuil défini,
 * APPRO = sous le seuil), les mots sont ceux du badge (`ALERTE_LABEL`). Deux ajouts de lecture seulement :
 *  - stock NÉGATIF : rouge et signalé « Négatif », quel que soit le seuil (c'est une anomalie à corriger) ;
 *  - quantité INCONNUE (`niveau` nul = pas de ligne de stock, la valeur « 0 » du tableau n'est alors
 *    qu'un défaut) : « — », jamais 0.
 */
export function etatStock(a: Pick<ArticleRow, "quantite" | "niveau">) {
  const q = a.quantite.trim() === "" ? Number.NaN : Number(a.quantite);
  const inconnu = a.niveau === null || !Number.isFinite(q);
  const negatif = !inconnu && q < 0;
  const ton: "rupture" | "bas" | "ok" | "inconnu" =
    inconnu ? "inconnu" : negatif || a.niveau === "URGENT" ? "rupture" : a.niveau === "APPRO" ? "bas" : "ok";
  return { inconnu, negatif, ton, quantite: inconnu ? null : q };
}
const TON_QUANTITE = { rupture: "text-red-700", bas: "text-amber-700", ok: "text-foreground", inconnu: "text-muted-foreground" } as const;
const TON_RANGEE = { rupture: "border-red-300 bg-red-50/60", bas: "border-amber-300 bg-amber-50/60", ok: "bg-card", inconnu: "bg-card" } as const;

/**
 * Article sur téléphone — équivalent mobile de LigneArticle. Fermé : UNE rangée compacte (case des
 * actions groupées, nom, stock + unité en gros, seuil). Ouvert : les champs éditables, avec le même
 * enregistrement case par case qu'avant (au blur, `onSave` → `modifierArticle`).
 */
export const CarteArticle = memo(function CarteArticle({
  a, categories, optionsFour, selected, onToggle, onSave, ouvert, onOuvrir, categorieNom, lectureSeule = false,
}: {
  a: ArticleRow; categories: Cat[]; optionsFour: OptionChoix[];
  selected: boolean; onToggle: (id: string) => void; onSave: (id: string, name: string, value: string) => Promise<unknown>;
  /** Hors Direction : champs en lecture seule (la modification se propose depuis la fiche). */
  lectureSeule?: boolean;
  ouvert: boolean; onOuvrir: (id: string) => void;
  /** Catégorie à rappeler sous le nom quand la liste n'est pas groupée par catégorie (liste triée). */
  categorieNom?: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const racine = useRef<HTMLDivElement>(null);
  // À l'ouverture, l'article reste visible en entier (marges d'écart : en-tête collant et barre du bas).
  useEffect(() => { if (ouvert) racine.current?.scrollIntoView?.({ block: "nearest" }); }, [ouvert]);
  const catsPour = categories.filter((c) => c.domaine === a.domaine);
  const write = (name: string, value: string, prev: string) => {
    if (lectureSeule || value === prev) return;
    setBusy(true);
    onSave(a.id, name, value).finally(() => setBusy(false));
  };
  const etat = etatStock(a);
  const unite = (a.unite ?? "").trim();
  const min = Number(a.stockMinimum);
  const idChamps = `champs-article-${a.id}`;
  const sousNom = [a.nomCourt?.trim(), categorieNom].filter(Boolean).join(" · ");

  return (
    <div ref={racine} data-article={a.id} className={`scroll-mb-24 scroll-mt-16 rounded-xl border ${selected ? "bg-primary/10" : TON_RANGEE[etat.ton]} ${busy ? "opacity-60" : ""}`}>
      <div className="flex items-stretch">
        {/* Case des actions groupées : la zone entière (44 px) est cliquable. */}
        <label className="flex w-11 shrink-0 cursor-pointer items-center justify-center">
          <input type="checkbox" checked={selected} onChange={() => onToggle(a.id)} className="h-5 w-5" aria-label={`Sélectionner ${a.designation}`} />
        </label>
        <button
          type="button"
          onClick={() => onOuvrir(a.id)}
          aria-expanded={ouvert}
          aria-controls={ouvert ? idChamps : undefined}
          title={ouvert ? "Replier les champs" : "Modifier l'article"}
          className="grid min-h-14 min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 py-1.5 pr-3 text-left"
        >
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{a.designation}</span>
            <span className="mt-0.5 flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
              {a.niveau && a.niveau !== "OK" && <span className={`shrink-0 rounded-full px-1.5 py-px font-medium ${ALERTE_CLASSE[a.niveau]}`}>{ALERTE_LABEL[a.niveau]}</span>}
              {etat.negatif && <span className="shrink-0 rounded-full bg-red-100 px-1.5 py-px font-medium text-red-800">Négatif</span>}
              {a.haussePct != null && <span className="shrink-0 rounded bg-red-100 px-1 py-px font-semibold text-red-700" title="Hausse du prix d'achat">📈+{Math.round(a.haussePct)}%</span>}
              {a.propositionEnAttente && <BadgeProposition />}
              {sousNom && <span className="truncate">{sousNom}</span>}
            </span>
          </span>
          <span className="text-right">
            <span data-stock={etat.ton} className={`block text-xl font-bold leading-tight tabular-nums ${TON_QUANTITE[etat.ton]}`}>
              {etat.quantite === null ? "—" : formaterNombre(etat.quantite, { maximumFractionDigits: 3 })}
              {etat.quantite !== null && unite && <span className="ml-1 text-sm font-semibold">{unite}</span>}
            </span>
            <span className="block text-[11px] text-muted-foreground">{Number.isFinite(min) && min > 0 ? `min. ${formaterNombre(min, { maximumFractionDigits: 3 })}` : "sans seuil"}</span>
          </span>
        </button>
      </div>

      {ouvert && (
        <div id={idChamps} className="border-t px-3 pb-3 pt-2">
          <div className="flex flex-wrap items-center gap-2">
            {a.surFicheCommande && <span className="rounded bg-primary/10 px-1 py-0.5 text-[10px] font-semibold text-primary" title="Sur la fiche Commande journalière">fiche cmd</span>}
            <Link href={`/stock/catalogue/${a.id}`} className="ml-auto inline-flex min-h-11 items-center gap-1 text-sm font-medium text-primary hover:text-primary/70" aria-label={`Fiche article — ${a.designation}`}>{lectureSeule ? "Proposer une modification ↗" : "Ouvrir la fiche ↗"}</Link>
          </div>
          <label className={champLabel}>Nom
            <input readOnly={lectureSeule} defaultValue={a.designation} onBlur={(e) => write("designation", e.target.value, a.designation)} className={`${cellCls} !py-1.5 !text-sm font-medium`} title="Modifier le nom" />
          </label>
          <label className={`${champLabel} mt-2`}>Nom court (fiche commande)
            <input readOnly={lectureSeule} defaultValue={a.nomCourt ?? ""} onBlur={(e) => write("nomCourt", e.target.value, a.nomCourt ?? "")} className={`${cellCls} !py-1.5`} placeholder="—" aria-label={`Nom court — ${a.designation}`} />
          </label>
          <div className="mt-2 grid grid-cols-2 gap-2 [&>*]:min-w-0">
            <label className={champLabel}>Stock min.
              <CelluleNombre readOnly={lectureSeule} groupe={a.categorieId ?? ""} ligne={a.id} col={0} valeur={nombreDeBase(a.stockMinimum)} onEnregistrer={(v) => onSave(a.id, "stockMinimum", texteDe(v))} min={0} quantite className={`${cellCls} !py-1.5 text-right`} aria-label={`Stock minimum — ${a.designation}`} />
            </label>
            <label className={champLabel}>Unité
              <input readOnly={lectureSeule} defaultValue={a.unite ?? ""} onBlur={(e) => write("unite", e.target.value, a.unite ?? "")} className={`${cellCls} !py-1.5`} placeholder="Kg, Pièce…" />
            </label>
            <label className={`${champLabel} col-span-2`}>Catégorie
              <select disabled={lectureSeule} defaultValue={a.categorieId ?? ""} onChange={(e) => write("categorieId", e.target.value, a.categorieId ?? "")} className={`${cellCls} !py-1.5 ${!a.categorieId ? "border-amber-400" : ""}`}>
                <option value="">— à classer —</option>
                {catsPour.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
              </select>
            </label>
            <label className={`${champLabel} col-span-2`}>
              <span className="flex items-center justify-between">Fournisseur
                {a.fournisseurId && (
                  <Link href={`/stock/fournisseurs/${a.fournisseurId}`} className="py-1 text-primary hover:underline">Voir la fiche ↗</Link>
                )}
              </span>
              <ChoixRecherche disabled={lectureSeule} options={optionsFour} defaultValue={a.fournisseurId ?? ""} vide="—" onChange={(v) => write("fournisseurId", v, a.fournisseurId ?? "")} aria-label={`Fournisseur — ${a.designation}`} className={`${cellCls} !py-1.5`} />
            </label>
            <label className={champLabel}>Code article
              <input readOnly={lectureSeule} defaultValue={a.code ?? ""} onBlur={(e) => write("code", e.target.value, a.code ?? "")} className={`${cellCls} !py-1.5`} placeholder="—" />
            </label>
            <label className={champLabel}>Prix {prixDe(a).symbole}{a.prixAutre ? ` (${a.prixAutre})` : ""}
              <CelluleNombre readOnly={lectureSeule} groupe={a.categorieId ?? ""} ligne={a.id} col={1} valeur={prixDe(a).valeur} onEnregistrer={(v) => onSave(a.id, prixDe(a).champ, texteDe(v))} min={0} className={`${cellCls} !py-1.5 text-right`} />
            </label>
            <label className={champLabel}>Unités / carton
              <CelluleNombre readOnly={lectureSeule} groupe={a.categorieId ?? ""} ligne={a.id} col={2} valeur={nombreDeBase(a.uniteParCarton)} onEnregistrer={(v) => onSave(a.id, "uniteParCarton", texteDe(v))} min={0} quantite className={`${cellCls} !py-1.5 text-right`} placeholder="ex. 24" />
            </label>
            <label className={champLabel}>Valeur du stock
              <span className="rounded border border-input/40 bg-muted/40 px-1.5 py-1.5 text-right text-xs tabular-nums text-muted-foreground">{texteValeur(a)}</span>
            </label>
          </div>
          <button type="button" onClick={() => onOuvrir(a.id)} className="mt-2 min-h-11 w-full rounded-md border text-sm font-medium hover:bg-accent">Replier</button>
        </div>
      )}
    </div>
  );
});

/** Pastille « proposition en attente » (même forme que les autres pastilles de la ligne). */
function BadgeProposition() {
  return <span title="Une modification proposée attend la décision de la Direction" className="shrink-0 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-semibold text-amber-800">proposition en attente</span>;
}

"use client";

import Link from "next/link";
import { memo, useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { estErreur } from "@/lib/action-lisible";
import { CLASSES_NEUTRE } from "@/components/action-buttons";
import { formaterNombre, formaterUSD } from "@/lib/montant";
import { normTexte } from "@/lib/texte";
import { UNITES_CONTENANCE, uniteManquante, type UniteArticle } from "@/lib/fiches/conversion";
import {
  articleVise, choixInitiaux, contenanceProposee, erreurContenanceChoisie, contenanceRequise, contenanceValideChoisie, planifierImportBar, uniteConvertible, UNITES_STOCK_COMPTAGE,
  type ContenanceChoisie, type LecturePhotos,
  type ArticleExistant, type ChoixFiche, type ChoixImportBar, type ChoixIngredient, type FicheBarLue,
  type FicheExistanteBar, type FeuilleNonLue, type FichePlan, type PropositionFiche, type PropositionIngredient, type StatutFiche,
} from "@/lib/fiches/classeur-bar";
import { analyserFichesBar, appliquerImportBar, envoyerPhotoFicheImport, type BilanImportBar } from "./import-bar-actions";
import { dejaLeger, reduireImage } from "./[id]/reduire-photo";

/** Taille maximale du fichier déposé (le classeur du bar fait 20 Mo, photos comprises). */
const TAILLE_MAX = 60 * 1024 * 1024;

const CHOIX_VIDE: ChoixImportBar = { fiches: {}, ingredients: {}, contenances: {} };

type Analyse = { fiches: PropositionFiche[]; ingredients: PropositionIngredient[]; articles: ArticleExistant[]; fichesBar: FicheExistanteBar[] };

const inp = "rounded border border-input bg-background px-1.5 py-1 text-xs";
const DOMAINES: { valeur: ChoixIngredient["domaine"]; libelle: string }[] = [
  { valeur: "BOISSON", libelle: "Boisson" }, { valeur: "NOURRITURE", libelle: "Nourriture" }, { valeur: "AUTRE", libelle: "Autre" },
];
const BADGE: Record<StatutFiche, { texte: string; classe: string }> = {
  PRETE: { texte: "prête", classe: "bg-emerald-100 text-emerald-800" },
  A_DECIDER: { texte: "à décider", classe: "bg-amber-100 text-amber-900" },
  BLOQUEE: { texte: "bloquée", classe: "bg-red-100 text-red-800" },
  DEJA_REMPLIE: { texte: "déjà remplie", classe: "bg-slate-200 text-slate-800" },
  IGNOREE: { texte: "ignorée", classe: "bg-muted text-muted-foreground" },
};
/** Prix d'achat du classeur, « à l'unité de consommation » (0,0286 $/cl) : 4 décimales au plus. */
const prixUnitaire = (n: number | null, unite: string) => (n === null ? "—" : `${formaterNombre(n, { maximumFractionDigits: 4 })} $/${unite}`);

/**
 * « Importer les fiches du bar (classeur Excel) » (Direction) : la Direction dépose le classeur de
 * ses fiches techniques de cocktails et de mocktails. Sans rien écrire, l'écran montre pour chaque
 * feuille la fiche visée et chaque ingrédient avec son article ; seules les correspondances SÛRES
 * sont acceptées d'office (même nom et même famille pour une fiche, même désignation pour un
 * article). Tout le reste se décide ici : fiche existante, créer, ignorer. Une unité qui ne se
 * convertit pas vers l'article choisi bloque la fiche. Le fichier est lu dans le navigateur.
 */
export function ImportFichesBar() {
  const router = useRouter();
  const [ouvert, setOuvert] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [lecture, setLecture] = useState(false);
  const [lues, setLues] = useState<FicheBarLue[] | null>(null);
  const [autres, setAutres] = useState<FeuilleNonLue[]>([]);
  const [analyse, setAnalyse] = useState<Analyse | null>(null);
  const [choix, setChoix] = useState<ChoixImportBar>(CHOIX_VIDE);
  const [bilan, setBilan] = useState<BilanImportBar | null>(null);
  const [envoi, start] = useTransition();

  const [photos, setPhotos] = useState<LecturePhotos | null>(null);
  /** Photo à importer, par feuille : absent = choix par défaut (photo propre à la feuille, fiche sans photo). */
  const [photosCochees, setPhotosCochees] = useState<Record<string, boolean>>({});
  const [envoiPhotos, setEnvoiPhotos] = useState<{ fait: number; total: number } | null>(null);
  const [bilanPhotos, setBilanPhotos] = useState<BilanPhotos | null>(null);
  // Vignettes : URL locales des images du classeur, libérées quand la simulation change.
  const vignettes = useMemo(() => {
    const m = new Map<string, string>();
    if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return m;
    for (const [f, p] of photos?.photos ?? []) m.set(f, URL.createObjectURL(new Blob([p.octets as BlobPart], { type: p.type })));
    return m;
  }, [photos]);
  useEffect(() => () => { for (const u of vignettes.values()) URL.revokeObjectURL?.(u); }, [vignettes]);

  const reinitialiser = () => { setLues(null); setAutres([]); setAnalyse(null); setChoix(CHOIX_VIDE); setPhotosCochees({}); };

  const lireFichier = async (f: File | undefined) => {
    setErreur(null); setBilan(null); setBilanPhotos(null); setPhotos(null); reinitialiser();
    if (!f) return;
    if (f.size > TAILLE_MAX) { setErreur("Fichier trop lourd (plus de 60 Mo) : ce n'est pas le classeur attendu."); return; }
    setLecture(true);
    let lu: Awaited<ReturnType<typeof import("@/lib/fiches/classeur-bar").lireClasseurBar>>;
    try {
      const { lireClasseurBar, lirePhotosClasseur } = await import("@/lib/fiches/classeur-bar");
      const octets = await f.arrayBuffer();
      lu = await lireClasseurBar(octets);
      // Photos lues dans le navigateur : le classeur (20 Mo) ne part jamais au serveur.
      setPhotos(lu.ok ? await lirePhotosClasseur(octets, lu.fiches.map((x) => x.feuille)) : null);
    } catch {
      setErreur("Fichier illisible : un classeur Excel (.xlsx) est attendu.");
      setLecture(false);
      return;
    }
    try {
      if (!lu.ok) { setErreur(lu.erreur); return; }
      const r = await analyserFichesBar(lu.fiches);
      if (estErreur(r)) { setErreur(r.erreur); return; }
      setLues(lu.fiches); setAutres(lu.autres);
      setAnalyse(r);
      setChoix(choixInitiaux(r.fiches, r.ingredients, r.articles));
    } catch {
      setErreur("Le serveur n'a pas pu comparer le classeur aux fiches (connexion ?). Réessayez.");
    } finally {
      setLecture(false);
    }
  };

  const plans = useMemo(
    () => (lues && analyse ? planifierImportBar(lues, choix, analyse.articles, analyse.fichesBar, analyse.ingredients) : []),
    [lues, analyse, choix],
  );
  const compte = (s: StatutFiche) => plans.filter((p) => p.statut === s).length;
  /** La fiche visée par la feuille a-t-elle déjà une photo ? (jamais remplacée par l'import) */
  const cibleAPhoto = (feuille: string) => {
    const c = plans.find((p) => p.feuille === feuille)?.cible;
    return !!c?.id && !!analyse?.fichesBar.find((f) => f.id === c.id)?.aPhoto;
  };
  const photoCochee = (feuille: string) => {
    const p = photos?.photos.get(feuille);
    if (!p || cibleAPhoto(feuille)) return false;
    return photosCochees[feuille] ?? (p.partageeAvec.length === 0 && !p.incertaine);
  };
  const changerPhoto = useCallback((feuille: string, oui: boolean) => setPhotosCochees((s) => ({ ...s, [feuille]: oui })), []);
  const prets = plans.filter((p) => p.statut === "PRETE");
  const articlesACreer = new Set(prets.flatMap((p) => p.lignes.filter((l) => l.statut === "OK" && l.article && !l.article.id).map((l) => l.cle))).size;
  /** Articles du catalogue SANS unité à qui l'import en donne une : nommés dans la confirmation. */
  const unitesPosees = [...new Map(prets.flatMap((p) => p.lignes.filter((l) => l.statut === "OK" && l.article?.id && l.article.contenanceAEcrire?.uniteStock)
    .map((l) => [l.article!.id!, `${l.article!.designation} → ${l.article!.contenanceAEcrire!.uniteStock}`] as const))).values()];
  const photosAEnvoyer = prets.filter((p) => photoCochee(p.feuille)).length;
  const contenancesAEcrire = new Set(prets.flatMap((p) => p.lignes.filter((l) => l.statut === "OK" && l.article?.id && l.article.contenanceAEcrire).map((l) => l.article!.id))).size;

  const changerFiche = useCallback((feuille: string, c: Partial<ChoixFiche>) =>
    setChoix((s) => ({ ...s, fiches: { ...s.fiches, [feuille]: { ...s.fiches[feuille]!, ...c } } })), []);
  const parIdArticle = useMemo(() => new Map((analyse?.articles ?? []).map((a) => [a.id, a])), [analyse]);
  /** Choisir un article compté à l'unité sans contenance pré-remplit celle LUE dans son nom (visible, modifiable). */
  const changerIngredient = useCallback((cle: string, c: Partial<ChoixIngredient>, p: { libelle: string; unites: string[] }) =>
    setChoix((s) => {
      const a = c.cible ? articleVise(p.libelle, c.cible, [...parIdArticle.values()]) : null;
      const contenances = a && !s.contenances[a.id] && contenanceRequise(a, p.unites)
        ? { ...s.contenances, [a.id]: (({ quantite, unite, uniteStock }) => ({ quantite, unite, uniteStock }))(contenanceProposee(a)) }
        : s.contenances;
      return { ...s, contenances, ingredients: { ...s.ingredients, [cle]: { ...s.ingredients[cle]!, ...c } } };
    }), [parIdArticle]);
  // Article visé par chaque libellé (le choisi, ou celui que « Créer » réutilise) : sa contenance saisie.
  const idVise = useMemo(() => new Map((analyse?.ingredients ?? []).map((p) => {
    const cible = choix.ingredients[p.cle]?.cible ?? "";
    return [p.cle, cible.startsWith("art:") ? cible.slice(4) : cible === "creer" ? articleVise(p.libelle, cible, analyse!.articles)?.id ?? null : null];
  })), [analyse, choix.ingredients]);
  const changerContenance = useCallback((articleId: string, c: Partial<ContenanceChoisie>) =>
    setChoix((s) => ({ ...s, contenances: { ...s.contenances, [articleId]: { ...(s.contenances[articleId] ?? { quantite: "", unite: "cl", uniteStock: null }), ...c } } })), []);

  /** Action groupée : remet TOUTES les correspondances sûres (fiches et ingrédients) ; ne touche à rien d'autre. */
  const accepterSures = () => {
    if (!analyse) return;
    const initiaux = choixInitiaux(analyse.fiches, analyse.ingredients, analyse.articles);
    setChoix((s) => ({
      // Les contenances déjà saisies sont gardées ; celles des articles sûrs manquantes, pré-remplies.
      contenances: { ...initiaux.contenances, ...s.contenances },
      // Une cible qui change décoche « Remplacer » : la case vaut pour UNE fiche, choisie à la main.
      fiches: { ...s.fiches, ...Object.fromEntries(analyse.fiches.filter((p) => p.ficheId).map((p) => {
        const c = s.fiches[p.feuille]!;
        const cible = `fiche:${p.ficheId}`;
        return [p.feuille, { ...c, cible, remplacer: c.cible === cible ? c.remplacer : false }];
      })) },
      ingredients: { ...s.ingredients, ...Object.fromEntries(analyse.ingredients.filter((p) => p.articleId).map((p) => [p.cle, { ...s.ingredients[p.cle]!, cible: `art:${p.articleId}` }])) },
    }));
  };

  const appliquer = () => {
    if (!lues || prets.length === 0) return;
    const creees = prets.filter((p) => p.cible?.id === null).length;
    const remplacees = prets.filter((p) => (p.cible?.nbIngredients ?? 0) > 0).length;
    if (!confirm(
      `Écrire ${prets.length} fiche(s) du bar ?\n\n` +
      `· ${prets.length - creees} fiche(s) existante(s) remplie(s)${remplacees ? `, dont ${remplacees} dont la recette actuelle sera REMPLACÉE` : ""}\n` +
      `· ${creees} fiche(s) créée(s)\n· ${articlesACreer} article(s) créé(s) au catalogue\n` +
      `· ${contenancesAEcrire} contenance(s) écrite(s) sur des articles du catalogue\n` +
      (unitesPosees.length ? `· unité de stock POSÉE sur des articles qui n'en avaient pas : ${unitesPosees.join(" ; ")}\n` : "") +
      `· ${photosAEnvoyer} photo(s) envoyée(s), une à une, aux fiches qui n'en ont pas\n\n` +
      "Les fiches « à décider », « bloquées » ou « déjà remplies » ne sont pas touchées. Le prix de vente des fiches existantes ne change pas.",
    )) return;
    setErreur(null);
    start(async () => {
      const r = await appliquerImportBar(lues, choix);
      if (estErreur(r)) { setErreur(r.erreur); return; }
      setBilan(r);
      // Photos : une par appel, seulement vers les fiches écrites, jamais par-dessus une photo existante.
      const aEnvoyer = r.fichesEcrites.filter((x) => photos?.photos.has(x.feuille) && photoCochee(x.feuille));
      const bp: BilanPhotos = { envoyees: [], gardees: [], echecs: [] };
      setEnvoiPhotos({ fait: 0, total: aEnvoyer.length });
      for (const [k, x] of aEnvoyer.entries()) {
        const p = photos!.photos.get(x.feuille)!;
        try {
          let fichier = new File([p.octets as BlobPart], p.chemin.split("/").pop()!, { type: p.type });
          if (!dejaLeger(fichier.size)) {
            try { fichier = (await reduireImage(fichier)).fichier; } catch { /* navigateur sans réduction : le serveur tranche (5 Mo) */ }
          }
          const fd = new FormData();
          fd.set("photo", fichier);
          const e = await envoyerPhotoFicheImport(x.ficheId, fd);
          if (estErreur(e)) bp.echecs.push(`${x.feuille} (${e.erreur})`);
          else (e.statut === "ENVOYEE" ? bp.envoyees : bp.gardees).push(x.feuille);
        } catch {
          bp.echecs.push(`${x.feuille} (connexion interrompue)`);
        }
        setEnvoiPhotos({ fait: k + 1, total: aEnvoyer.length });
      }
      setEnvoiPhotos(null);
      if (aEnvoyer.length) setBilanPhotos(bp);
      reinitialiser();
      setPhotos(null);
      router.refresh();
    });
  };

  if (!ouvert) {
    return (
      <div className="space-y-2">
        <button onClick={() => setOuvert(true)} className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">Importer les fiches du bar (classeur Excel)</button>
        {bilan && <CompteRendu bilan={bilan} photos={bilanPhotos} />}
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border bg-muted/20 p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">Importer les fiches techniques du bar (cocktails, mocktails…)</p>
        <button onClick={() => { setOuvert(false); reinitialiser(); setErreur(null); }} className="text-sm text-muted-foreground underline">Fermer</button>
      </div>
      <p className="text-xs text-muted-foreground">
        Déposez le classeur (.xlsx). Rien n&apos;est écrit avant « Appliquer » : l&apos;écran montre d&apos;abord, pour chaque feuille, la fiche visée et chaque ingrédient avec son article du catalogue.
        Seules les correspondances sûres sont acceptées d&apos;office ; le reste se décide ici. Une fiche qui a déjà une recette n&apos;est remplacée que si vous cochez « Remplacer ». Le prix de vente d&apos;une fiche existante ne change pas.
      </p>
      <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={lecture || envoi}
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; lireFichier(f); }} className="block w-full max-w-md text-sm" aria-label="Classeur des fiches techniques du bar" />
      {lecture && <p className="text-sm text-muted-foreground">Lecture du classeur…</p>}
      {erreur && <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erreur}</p>}

      {lues && analyse && (
        <>
          {/* Barre d'actions groupées, collée en haut pendant le défilement. */}
          <div className="sticky colle-sous-entete z-20 flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm shadow-sm">
            <span className="font-medium">
              {lues.length} feuille(s) · <span className="text-emerald-800">{compte("PRETE")} prête(s)</span>
              {compte("A_DECIDER") > 0 && <> · <span className="text-amber-900">{compte("A_DECIDER")} à décider</span></>}
              {compte("BLOQUEE") > 0 && <> · <span className="text-red-800">{compte("BLOQUEE")} bloquée(s)</span></>}
              {compte("DEJA_REMPLIE") > 0 && <> · {compte("DEJA_REMPLIE")} déjà remplie(s)</>}
              {compte("IGNOREE") > 0 && <> · {compte("IGNOREE")} ignorée(s)</>}
            </span>
            <button onClick={accepterSures} className={CLASSES_NEUTRE}>Accepter les correspondances sûres</button>
            <button onClick={appliquer} disabled={envoi || prets.length === 0} className="ml-auto rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground disabled:opacity-50">
              {envoi ? "Écriture…" : `Appliquer (${prets.length} fiche${prets.length > 1 ? "s" : ""})`}
            </button>
          </div>
          {autres.length > 0 && (
            <p className="text-xs text-muted-foreground">Feuille(s) laissée(s) de côté : {autres.map((a) => `« ${a.feuille} » (${a.raison})`).join(" ; ")}.</p>
          )}

          <section className="space-y-1">
            <h3 className="text-sm font-semibold">1. Fiches — une par feuille du classeur</h3>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[46rem] border-separate border-spacing-0 text-sm">
                <thead className="bg-muted/50 text-left text-xs">
                  <tr className="[&>th]:border-b [&>th]:px-2 [&>th]:py-1.5 [&>th]:font-medium">
                    <th>Classeur</th><th>Fiche visée</th><th>État</th>
                  </tr>
                </thead>
                <tbody className="[&>tr>td]:border-b [&>tr>td]:px-2 [&>tr>td]:py-1.5 [&>tr>td]:align-top">
                  {lues.map((l, i) => (
                    <LigneFiche key={l.feuille} lue={l} proposition={analyse.fiches[i]!} plan={plans[i]!} choix={choix.fiches[l.feuille]!}
                      fichesBar={analyse.fichesBar} onChange={changerFiche}
                      photo={photos?.photos.get(l.feuille) ? { url: vignettes.get(l.feuille) ?? null, partageeAvec: photos.photos.get(l.feuille)!.partageeAvec, incertaine: photos.photos.get(l.feuille)!.incertaine, cochee: photoCochee(l.feuille), dejaUne: cibleAPhoto(l.feuille) } : null}
                      onPhoto={changerPhoto} />
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="space-y-1">
            <h3 className="text-sm font-semibold">2. Ingrédients — {analyse.ingredients.length} libellé(s) distinct(s), chacun décidé une seule fois</h3>
            <p className="text-xs text-muted-foreground">
              « Créer l&apos;article » l&apos;ajoute au catalogue avec l&apos;unité et le prix du classeur, ramené au litre ou au kilo ; un prix absent au classeur donne un article sans prix (coût « — »), jamais 0.
              « Ignorer la ligne » écrit la fiche sans cet ingrédient et le note dans sa recette (« Non repris du classeur »).
            </p>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[46rem] border-separate border-spacing-0 text-sm">
                <thead className="bg-muted/50 text-left text-xs">
                  <tr className="[&>th]:border-b [&>th]:px-2 [&>th]:py-1.5 [&>th]:font-medium">
                    <th>Article du classeur</th><th>Article de l&apos;application</th><th>Unités</th>
                  </tr>
                </thead>
                <tbody className="[&>tr>td]:border-b [&>tr>td]:px-2 [&>tr>td]:py-1.5 [&>tr>td]:align-top">
                  {analyse.ingredients.map((p) => (
                    <LigneIngredient key={p.cle} proposition={p} choix={choix.ingredients[p.cle]!} articles={analyse.articles} onChange={changerIngredient}
                      contenance={idVise.get(p.cle) ? choix.contenances[idVise.get(p.cle)!] : undefined}
                      onContenance={changerContenance} />
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
      {envoiPhotos && <p className="text-sm text-muted-foreground">Envoi des photos… {envoiPhotos.fait}/{envoiPhotos.total}</p>}
      {bilan && <CompteRendu bilan={bilan} photos={bilanPhotos} />}
    </div>
  );
}

// ─── Une feuille ─────────────────────────────────────────────────────────────

const LigneFiche = memo(function LigneFiche({ lue, proposition, plan, choix, fichesBar, onChange, photo, onPhoto }: {
  lue: FicheBarLue; proposition: PropositionFiche; plan: FichePlan; choix: ChoixFiche; fichesBar: FicheExistanteBar[];
  onChange: (feuille: string, c: Partial<ChoixFiche>) => void;
  /** Photo de la feuille (null : aucune, ou le seul logo partagé). */
  photo: { url: string | null; partageeAvec: string[]; incertaine: boolean; cochee: boolean; dejaUne: boolean } | null;
  onPhoto: (feuille: string, oui: boolean) => void;
}) {
  const parRubrique = useMemo(() => {
    const m = new Map<string, FicheExistanteBar[]>();
    for (const f of fichesBar) m.set(f.categorie || "Sans rubrique", [...(m.get(f.categorie || "Sans rubrique") ?? []), f]);
    return [...m];
  }, [fichesBar]);
  const choisie = choix.cible.startsWith("fiche:") ? fichesBar.find((f) => f.id === choix.cible.slice(6)) : undefined;
  const sure = proposition.ficheId !== null && choix.cible === `fiche:${proposition.ficheId}`;
  const badge = BADGE[plan.statut];
  const ok = plan.lignes.filter((l) => l.statut === "OK").length;

  return (
    <tr className={plan.statut === "IGNOREE" ? "text-muted-foreground" : ""}>
      <td className="w-64">
        <div className="font-medium">{lue.nom}</div>
        <div className="text-xs text-muted-foreground">
          {[lue.type ?? "type ?", `${lue.verres ?? "—"} verre(s)`, `prix TTC du classeur ${lue.prixTTC !== null ? formaterUSD(lue.prixTTC) : "—"}`].join(" · ")}
        </div>
        <div className="text-[11px] text-muted-foreground">feuille « {lue.feuille} »</div>
        {photo && (
          <div className="mt-1 flex items-start gap-2 text-[11px]">
            {photo.url
              // eslint-disable-next-line @next/next/no-img-element -- image locale (blob:) du classeur, jamais servie par Next
              ? <img src={photo.url} alt={`Photo de ${lue.nom} (classeur)`} className="h-12 w-12 shrink-0 rounded object-cover" />
              : <span className="h-12 w-12 shrink-0 rounded bg-muted" />}
            <label className="flex items-start gap-1">
              <input type="checkbox" checked={photo.cochee} disabled={photo.dejaUne || plan.statut === "IGNOREE"} onChange={(e) => onPhoto(lue.feuille, e.target.checked)} aria-label={`Importer la photo de ${lue.nom}`} />
              <span>
                {photo.dejaUne ? "la fiche a déjà une photo : gardée" : "importer la photo"}
                {photo.partageeAvec.length > 0 && <span className="block text-amber-800">partagée avec « {photo.partageeAvec.join(" », « ")} » : à cocher si c&apos;est bien elle</span>}
                {photo.incertaine && photo.partageeAvec.length === 0 && <span className="block text-amber-800">classeur trop court pour reconnaître le logo d&apos;en-tête : à cocher si c&apos;est bien la photo</span>}
              </span>
            </label>
          </div>
        )}
      </td>
      <td className="min-w-64">
        <select value={choix.cible} onChange={(e) => onChange(lue.feuille, { cible: e.target.value, remplacer: false })}
          className={`${inp} w-full max-w-xs ${choix.cible === "" ? "border-amber-400" : ""}`} aria-label={`Fiche visée par ${lue.nom}`}>
          <option value="">— à décider —</option>
          {proposition.suggestions.length > 0 && (
            <optgroup label="Proches (à vérifier)">
              {proposition.suggestions.map((s) => <option key={s.id} value={`fiche:${s.id}`}>{s.libelle}</option>)}
            </optgroup>
          )}
          <option value="creer">Créer la fiche « {lue.nom} »</option>
          <option value="ignorer">Ignorer cette feuille</option>
          {parRubrique.map(([rubrique, fs]) => (
            <optgroup key={rubrique} label={rubrique}>
              {fs.map((f) => <option key={f.id} value={`fiche:${f.id}`}>{f.nom}{f.nbIngredients ? ` (${f.nbIngredients} ingr.)` : ""}{f.actif ? "" : " — inactive"}</option>)}
            </optgroup>
          ))}
        </select>
        {sure && (
          <p className="mt-0.5 text-[11px] text-emerald-800">
            correspondance sûre{proposition.correspondance === "orthographe" ? ` (à une lettre près : « ${lue.nom} » / « ${choisie?.nom} »)` : " (même nom, même famille)"}
          </p>
        )}
        {!proposition.ficheId && proposition.doute && <p className="mt-0.5 text-[11px] text-amber-800">{proposition.doute}</p>}
        {choix.cible === "creer" && (
          <label className="mt-1 flex flex-wrap items-center gap-1 text-[11px]">
            Rubrique
            <input value={choix.categorie} onChange={(e) => onChange(lue.feuille, { categorie: e.target.value })} className={`${inp} w-36`} aria-label={`Rubrique de la fiche ${lue.nom}`} />
            {plan.cible?.id ? <span className="text-amber-800">existe déjà : elle sera réutilisée</span> : <span className="text-muted-foreground">prix TTC {plan.cible?.prixVenteTTC != null ? formaterUSD(plan.cible.prixVenteTTC) : "—"}</span>}
          </label>
        )}
        {choisie && (
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            <Link href={`/stock/fiches/${choisie.id}`} className="text-primary hover:underline">ouvrir la fiche</Link>
            {" · "}prix de la fiche {choisie.prixVenteTTC !== null ? formaterUSD(choisie.prixVenteTTC) : "—"} (inchangé)
          </p>
        )}
        {(plan.cible?.nbIngredients ?? 0) > 0 && (
          <label className="mt-1 flex items-center gap-1 text-[11px] font-medium text-red-800">
            <input type="checkbox" checked={choix.remplacer} onChange={(e) => onChange(lue.feuille, { remplacer: e.target.checked })} />
            Remplacer la recette existante ({plan.cible!.nbIngredients} ingrédient(s))
          </label>
        )}
      </td>
      <td className="min-w-56">
        <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${badge.classe}`}>{badge.texte}</span>
        {plan.raisons.length > 0 && <ul className="mt-0.5 list-disc pl-4 text-[11px] text-muted-foreground">{plan.raisons.map((r, k) => <li key={k}>{r}</li>)}</ul>}
        {plan.statut !== "IGNOREE" && plan.lignes.length > 0 && (
          <details className="mt-1 text-[11px]" open={plan.statut === "BLOQUEE"}>
            <summary className="cursor-pointer text-muted-foreground">{ok}/{plan.lignes.length} ingrédient(s) prêt(s)</summary>
            <ul className="mt-0.5 space-y-0.5">
              {plan.lignes.map((l, k) => (
                <li key={k} className={l.statut === "OK" ? "" : l.statut === "IGNOREE" ? "text-muted-foreground line-through" : l.statut === "BLOQUEE" ? "text-red-800" : "text-amber-900"}>
                  {l.quantite !== null ? formaterNombre(l.quantite) : "—"} {l.unite ?? ""} · {l.libelle}
                  {l.article ? ` → ${l.article.designation}${l.article.id ? "" : " (à créer)"}` : ""}
                  {l.motif && l.statut !== "IGNOREE" ? ` — ${l.motif}` : ""}
                </li>
              ))}
            </ul>
          </details>
        )}
      </td>
    </tr>
  );
});

// ─── Un ingrédient (un libellé distinct) ─────────────────────────────────────

const LigneIngredient = memo(function LigneIngredient({ proposition: p, choix, articles, onChange, contenance, onContenance }: {
  proposition: PropositionIngredient; choix: ChoixIngredient; articles: ArticleExistant[];
  onChange: (cle: string, c: Partial<ChoixIngredient>, p: { libelle: string; unites: string[] }) => void;
  /** Contenance saisie pour l'article choisi (s'il en faut une). */
  contenance: ContenanceChoisie | undefined;
  onContenance: (articleId: string, c: Partial<ContenanceChoisie>) => void;
}) {
  const [recherche, setRecherche] = useState<string | null>(null);
  const parId = useMemo(() => new Map(articles.map((a) => [a.id, a])), [articles]);
  const choisi = choix.cible.startsWith("art:") ? parId.get(choix.cible.slice(4)) : undefined;
  const sure = p.articleId !== null && choix.cible === `art:${p.articleId}`;
  const resultats = useMemo(() => {
    if (recherche === null) return [];
    const n = normTexte(recherche.trim());
    return (n ? articles.filter((a) => normTexte(a.designation).includes(n)) : articles).slice(0, 20);
  }, [recherche, articles]);
  const suggestions = p.suggestions.map((id) => parId.get(id)).filter((a): a is ArticleExistant => !!a);
  // Article visé : le choisi, ou celui que « Créer » réutilisera (même nom, même contenance).
  const vise = useMemo(() => articleVise(p.libelle, choix.cible, articles), [p.libelle, choix.cible, articles]);
  const reutilise = choix.cible === "creer" && vise !== null;
  const requise = vise ? contenanceRequise(vise, p.unites) : false;
  const lueDansNom = vise ? contenanceProposee(vise) : null;
  // Article tel que la conversion le verra : sa contenance en base, sinon celle saisie ici.
  const effectif: UniteArticle | null = vise
    ? requise
      ? { unite: vise.unite || contenance?.uniteStock || null, contenance: contenanceValideChoisie(contenance, vise) ? contenance.quantite.replace(",", ".") : null, contenanceUnite: contenance?.unite ?? null }
      : vise
    : choix.cible === "creer" && p.creation ? { unite: p.creation.unite } : null;
  const libelleCible = (a: UniteArticle) => `${a.unite || "article sans unité"}${a.contenance ? ` de ${formaterNombre(Number(a.contenance))} ${a.contenanceUnite}` : ""}`;

  return (
    <tr className={choix.cible === "ignorer" ? "text-muted-foreground" : ""}>
      <td className="w-64">
        <div className="font-medium">{p.libelle}</div>
        <div className="text-[11px] text-muted-foreground" title={p.feuilles.join(", ")}>
          {p.feuilles.length} fiche(s) · classeur {prixUnitaire(p.creation?.prixClasseur ?? null, p.creation?.uniteClasseur ?? p.unites[0] ?? "?")}
        </div>
      </td>
      <td className="min-w-72">
        <select value={choix.cible} onChange={(e) => { if (e.target.value === "chercher") setRecherche(""); else onChange(p.cle, { cible: e.target.value }, p); }}
          className={`${inp} w-full max-w-xs ${choix.cible === "" ? "border-amber-400" : ""}`} aria-label={`Article pour ${p.libelle}`}>
          <option value="">— à décider —</option>
          {choisi && !suggestions.some((a) => a.id === choisi.id) && <option value={`art:${choisi.id}`}>{choisi.designation} ({choisi.unite || "unité ?"})</option>}
          {suggestions.length > 0 && (
            <optgroup label="Proches (à vérifier)">
              {suggestions.map((a) => <option key={a.id} value={`art:${a.id}`}>{a.designation} ({a.unite || "unité ?"})</option>)}
            </optgroup>
          )}
          {/* « Créer » seulement si aucun article ne porte déjà ce nom (sinon il serait réutilisé). */}
          {p.creation && !p.articleId && !p.doute && <option value="creer">Créer l&apos;article « {p.creation.designation} » ({p.creation.unite})</option>}
          <option value="ignorer">Ignorer la ligne</option>
          <option value="chercher">Chercher un autre article du catalogue…</option>
        </select>
        {sure && <p className="mt-0.5 text-[11px] text-emerald-800">correspondance sûre (même désignation)</p>}
        {!p.articleId && p.doute && <p className="mt-0.5 text-[11px] text-amber-800">{p.doute}</p>}
        {vise && (
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {reutilise && <span className="block text-amber-800">« Créer » : un article porte déjà ce nom et cette contenance, il sera réutilisé</span>}
            <Link href={`/stock/catalogue/${vise.id}`} className="text-primary hover:underline">{vise.designation}</Link>
            {" · "}{vise.prixUnitaireUSD !== null ? `${formaterNombre(vise.prixUnitaireUSD, { maximumFractionDigits: 4 })} $/${vise.unite || "?"}` : "sans prix (coût « — »)"}
            {vise.contenance ? ` · contenance ${formaterNombre(Number(vise.contenance))} ${vise.contenanceUnite}` : ""}
          </p>
        )}
        {vise && requise && (
          <div className={`mt-1 flex flex-wrap items-center gap-1 rounded border px-1.5 py-1 text-[11px] ${contenanceValideChoisie(contenance, vise) ? "border-amber-300 bg-amber-50" : "border-red-300 bg-red-50"}`}>
            {uniteManquante(vise.unite) && (
              <>
                Unité de stock
                <select value={contenance?.uniteStock ?? ""} onChange={(e) => onContenance(vise.id, { uniteStock: e.target.value || null })} className={inp} aria-label={`Unité de stock de ${vise.designation}`}>
                  <option value="">— à choisir —</option>
                  {UNITES_STOCK_COMPTAGE.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
                <span className="text-red-800">prix actuel : {vise.prixUnitaireUSD !== null ? `${formaterNombre(vise.prixUnitaireUSD, { maximumFractionDigits: 4 })} $ par ?` : "— par ?"}</span>
              </>
            )}
            1 {vise.unite || contenance?.uniteStock || "unité"} =
            <input value={contenance?.quantite ?? ""} inputMode="decimal" onChange={(e) => onContenance(vise.id, { quantite: e.target.value })}
              className={`${inp} w-16`} aria-label={`Contenance de ${vise.designation}`} />
            <select value={contenance?.unite ?? "cl"} onChange={(e) => onContenance(vise.id, { unite: e.target.value })} className={inp} aria-label={`Unité de contenance de ${vise.designation}`}>
              {UNITES_CONTENANCE.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>
            <span className="text-muted-foreground">
              {lueDansNom?.lue && contenance?.quantite === lueDansNom.quantite && contenance.unite === lueDansNom.unite
                ? `${formaterNombre(Number(lueDansNom.quantite))} ${lueDansNom.unite}, lu dans le nom — à vérifier`
                : lueDansNom?.lue ? "saisie à la main" : "illisible dans le nom : à saisir"}
              {" · sera écrite sur l'article"}
            </span>
            {erreurContenanceChoisie(contenance, vise) && <span className="block w-full text-red-800">{erreurContenanceChoisie(contenance, vise)}</span>}
          </div>
        )}
        {choix.cible === "creer" && p.creation && (
          <label className="mt-1 flex flex-wrap items-center gap-1 text-[11px]">
            {p.creation.prixUnitaireUSD !== null ? `${formaterNombre(Number(p.creation.prixUnitaireUSD), { maximumFractionDigits: 4 })} $/${p.creation.unite}` : "sans prix (coût « — »)"} · domaine
            <select value={choix.domaine} onChange={(e) => onChange(p.cle, { domaine: e.target.value as ChoixIngredient["domaine"] }, p)} className={inp} aria-label={`Domaine de l'article ${p.libelle}`}>
              {DOMAINES.map((d) => <option key={d.valeur} value={d.valeur}>{d.libelle}</option>)}
            </select>
          </label>
        )}
        {recherche !== null && (
          <div className="mt-1 max-w-xs space-y-1">
            <input autoFocus value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder="Rechercher un article…" className={`${inp} w-full`} aria-label={`Rechercher un article pour ${p.libelle}`} />
            <ul className="max-h-48 overflow-auto rounded border bg-card text-xs">
              {resultats.map((a) => (
                <li key={a.id}>
                  <button type="button" onClick={() => { onChange(p.cle, { cible: `art:${a.id}` }, p); setRecherche(null); }} className="w-full px-2 py-1 text-left hover:bg-accent">
                    {a.designation} <span className="text-muted-foreground">({a.unite || "unité ?"})</span>
                  </button>
                </li>
              ))}
              {resultats.length === 0 && <li className="px-2 py-1 text-muted-foreground">Aucun article.</li>}
            </ul>
            <button type="button" onClick={() => setRecherche(null)} className="text-xs underline">Annuler</button>
          </div>
        )}
      </td>
      <td className="min-w-40 text-[11px]">
        {p.unites.length === 0 && <span className="text-red-800">unité vide au classeur</span>}
        {p.unites.map((u) => {
          if (effectif === null || choix.cible === "ignorer") return <div key={u}>{u}</div>;
          if (requise && !contenanceValideChoisie(contenance, vise!)) return <div key={u} className="font-medium text-red-800">{u} → {vise!.unite || "?"} : contenance à renseigner</div>;
          const ok = uniteConvertible(u, effectif);
          return <div key={u} className={ok ? "text-emerald-800" : "font-medium text-red-800"}>{u} → {libelleCible(effectif)}{ok ? "" : " : inconvertible"}</div>;
        })}
      </td>
    </tr>
  );
});

// ─── Compte-rendu ────────────────────────────────────────────────────────────

type BilanPhotos = { envoyees: string[]; gardees: string[]; echecs: string[] };

function CompteRendu({ bilan: b, photos }: { bilan: BilanImportBar; photos: BilanPhotos | null }) {
  const liste = (titre: string, noms: string[]) => noms.length > 0 && <li><span className="font-medium">{titre} ({noms.length})</span> : {noms.join(", ")}</li>;
  return (
    <div className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
      <p className="font-medium">Import des fiches du bar terminé.</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
        {liste("Fiches remplies", b.remplies)}
        {liste("Fiches créées", b.creees)}
        {liste("Articles créés au catalogue", b.articlesCrees)}
        {liste("Contenances écrites sur le catalogue", b.contenancesEcrites)}
        {liste("Déjà remplies, laissées telles quelles", b.dejaRemplies)}
        {liste("Recette identique, rien réécrit", b.identiques)}
        {liste("Texte de recette existant conservé", b.recettesConservees)}
        {liste("Feuilles ignorées", b.ignorees)}
        {b.nonEcrites.length > 0 && <li><span className="font-medium">Non écrites ({b.nonEcrites.length})</span> : {b.nonEcrites.map((n) => `${n.feuille} (${n.raisons.join(" ; ")})`).join(" · ")}</li>}
        {b.lignesIgnorees.length > 0 && <li><span className="font-medium">Ingrédients ignorés ({b.lignesIgnorees.length})</span> : {b.lignesIgnorees.map((l) => `${l.libelle} (${l.fiche})`).join(", ")}</li>}
        {photos && liste("Photos importées", photos.envoyees)}
        {photos && liste("Photos non importées (la fiche en avait déjà une)", photos.gardees)}
        {photos && photos.echecs.length > 0 && <li className="text-red-800"><span className="font-medium">Photos en échec ({photos.echecs.length})</span> : {photos.echecs.join(", ")} — à ajouter depuis la fiche</li>}
      </ul>
    </div>
  );
}

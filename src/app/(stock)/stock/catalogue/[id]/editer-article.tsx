"use client";

import { useMemo, useState, useTransition } from "react";
import { modifierArticle } from "../actions";
import { estErreur } from "@/lib/action-lisible";
import { CelluleNombre } from "@/components/tableur/cellule-nombre";
import { ZoneTableur } from "@/components/tableur/messages";
import { ecrireSaisieNombre, lireSaisieNombre } from "@/lib/nombre";
import { canoniqueVersSaisie } from "@/lib/saisie-nombre-stock";
import { empecherEnvoiParEntree } from "@/lib/entree-sans-envoi";
import { ChoixRecherche } from "@/components/choix-recherche";
import { optionsFournisseurs } from "@/lib/recherche-options";
import { contenanceDansNom, UNITES_CONTENANCE } from "@/lib/fiches/conversion";
import { formaterPrix, prixProposeEn, type DevisePrix } from "@/lib/prix-article";

type Cat = { id: string; nom: string; domaine: string };
type Four = { id: string; nom: string };

export type ArticleEdit = {
  id: string;
  domaine: "NOURRITURE" | "BOISSON" | "AUTRE";
  code: string | null;
  designation: string;
  nomCourt: string | null;
  unite: string | null;
  /** Contenance d'une unité comptée à l'unité (« 75 » + « cl ») ; null = inconnue. */
  contenance?: string | null;
  contenanceUnite?: string | null;
  uniteParCarton: string | null;
  prixUnitaireUSD: string | null;
  /** Devise de saisie du prix (absente = $) et prix en francs d'un article en FC. */
  devisePrix?: DevisePrix;
  prixUnitaireCDF?: string | null;
  categorieId: string | null;
  fournisseurId: string | null;
  stockMinimum: string;
  seuilUrgent: string;
};

const inp = "w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm";
/** Texte de saisie (français) → valeur de case ; l'inverse pour le champ caché envoyé au serveur
 *  (`decSaisiOptionnel`) — même lecture/écriture que la Liste d'achat de légumes. Les valeurs venues de
 *  la base (« 2.125 ») sont écrites à la française par `canoniqueVersSaisie` AVANT d'entrer dans le state. */
const nombreOuNull = (s: string | null) => { const l = lireSaisieNombre(s ?? ""); return l.ok ? l.valeur : null; };
const texteDe = (v: number | null) => (v === null ? "" : ecrireSaisieNombre(v));

/**
 * Bouton « Modifier » de la fiche article, et son formulaire. RÉUTILISE `modifierArticle` (même
 * action, mêmes règles, même journalisation) que la case éditable de l'Inventaire — mêmes droits
 * aussi : cette page est déjà réservée aux comptes du module Stock (`exigerPageStock`), et
 * l'Inventaire ne restreint pas non plus l'édition par rôle ; tout compte qui voit la fiche peut
 * donc déjà modifier l'article dans Inventaire, ce bouton ne fait qu'ouvrir les mêmes champs ici.
 *
 * N'envoie JAMAIS `quantite` : le stock ne se modifie que par un mouvement, l'inventaire (comptage)
 * ou la correction de stock négatif — jamais par ce formulaire.
 */
export function EditerArticle({ a, categories, fournisseurs, estDirection = true, taux = null }: { a: ArticleEdit; categories: Cat[]; fournisseurs: Four[]; estDirection?: boolean; taux?: number | null }) {
  const optionsFour = useMemo(() => optionsFournisseurs(fournisseurs), [fournisseurs]);
  const [ouvert, setOuvert] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null); // proposition envoyée (hors Direction)
  const [isPending, start] = useTransition();
  // Cases numériques : valeur tenue en state (texte), portée par un champ caché du même nom que
  // lit `modifierArticle` — comme les lignes de la Liste d'achat de légumes.
  // Prix de référence : SA devise ($ ou FC) et le prix dans cette devise (la devise de saisie fait foi).
  const deviseInitiale: DevisePrix = a.devisePrix === "CDF" ? "CDF" : "USD";
  const [devise, setDevise] = useState<DevisePrix>(deviseInitiale);
  const [prix, setPrix] = useState(canoniqueVersSaisie(deviseInitiale === "CDF" ? a.prixUnitaireCDF ?? null : a.prixUnitaireUSD));
  const [prixConverti, setPrixConverti] = useState(false); // prix proposé par conversion au taux du jour (à vérifier)
  /**
   * Changer de devise : le prix saisi dans la nouvelle devise est PROPOSÉ au taux du jour (à vérifier,
   * modifiable) ; revenir à la devise d'origine retrouve le prix enregistré. Rien n'est converti en
   * base : c'est le prix affiché dans le champ qui sera enregistré, dans la devise choisie.
   */
  const changerDevise = (d: DevisePrix) => {
    if (d === devise) return;
    setDevise(d);
    if (d === deviseInitiale) { setPrix(canoniqueVersSaisie(d === "CDF" ? a.prixUnitaireCDF ?? null : a.prixUnitaireUSD)); setPrixConverti(false); return; }
    const n = nombreOuNull(prix);
    const propose = n !== null && n > 0 ? prixProposeEn(devise === "USD" ? { devisePrix: "USD", prixUnitaireUSD: n } : { devisePrix: "CDF", prixUnitaireUSD: null, prixUnitaireCDF: n }, d, taux) : null;
    setPrix(propose === null ? "" : texteDe(propose));
    setPrixConverti(propose !== null);
  };
  const prixLu = nombreOuNull(prix);
  const autreDevise: DevisePrix = devise === "USD" ? "CDF" : "USD";
  const equivalent = prixLu !== null && prixLu > 0 && taux ? (devise === "USD" ? prixLu * taux : prixLu / taux) : null;
  const [parCarton, setParCarton] = useState(canoniqueVersSaisie(a.uniteParCarton));
  const [contenance, setContenance] = useState(canoniqueVersSaisie(a.contenance));
  const lue = contenanceDansNom(a.designation);
  const [seuilMin, setSeuilMin] = useState(canoniqueVersSaisie(a.stockMinimum));
  const [seuilUrgent, setSeuilUrgent] = useState(canoniqueVersSaisie(a.seuilUrgent));
  // Catégories du domaine de l'article — PLUS sa catégorie actuelle si elle est d'un autre domaine
  // (import, reclassement) : absente de la liste, le select retomberait sur « à classer » et
  // l'enregistrement effacerait la catégorie sans que personne l'ait demandé.
  const catsPour = categories.filter((c) => c.domaine === a.domaine || c.id === a.categorieId);

  const enregistrer = (fd: FormData) => {
    setErreur(null);
    start(async () => {
      const r = await modifierArticle(a.id, fd);
      if (estErreur(r)) { setErreur(r.erreur); return; }
      if (r && "message" in r) setInfo(r.message);
      setOuvert(false);
    });
  };

  if (!ouvert) {
    // Hors Direction : on PROPOSE une modification (la Direction la valide ou la refuse).
    return (
      <>
        <button onClick={() => { setInfo(null); setOuvert(true); }} className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">{estDirection ? "Modifier" : "Proposer une modification"}</button>
        {info && <p className="w-full rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">{info}</p>}
      </>
    );
  }

  return (
    <form action={enregistrer} onKeyDown={empecherEnvoiParEntree} className="w-full rounded-xl border bg-muted/20 p-4">
      {erreur && <p className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erreur}</p>}
      <ZoneTableur>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">Désignation *
            <input name="designation" defaultValue={a.designation} required className={inp} />
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">Nom court (fiche Commande journalière)
            <input name="nomCourt" defaultValue={a.nomCourt ?? ""} placeholder="ex. Carré d'agneau" className={inp} />
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">Code article
            <input name="code" defaultValue={a.code ?? ""} placeholder="ex. 137" className={inp} />
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">Unité
            <input name="unite" defaultValue={a.unite ?? ""} placeholder="Kg, Pièce…" className={inp} />
          </label>
          <div className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
            <span>Contenance d&apos;une unité (bouteille, pièce…)</span>
            <div className="flex gap-1">
              <input type="hidden" name="contenance" value={contenance} />
              <CelluleNombre ligne="article" col={4} valeur={nombreOuNull(contenance)} onEnregistrer={(v) => setContenance(texteDe(v))} min={0} quantite
                placeholder={lue ? `lu dans le nom : ${canoniqueVersSaisie(lue.quantite.toString())}` : "ex. 75"} className={`${inp} text-right`} aria-label="Contenance" />
              <select name="contenanceUnite" defaultValue={a.contenanceUnite ?? ""} className={`${inp} w-20`} aria-label="Unité de contenance">
                <option value="">—</option>
                {UNITES_CONTENANCE.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <span className="text-[11px]">Sert au coût des fiches consommées en cl ou en g{lue && !a.contenance ? ` — le nom indique ${canoniqueVersSaisie(lue.quantite.toString())} ${lue.unite}` : ""}.</span>
          </div>
          <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">Unités / carton
            <input type="hidden" name="uniteParCarton" value={parCarton} />
            <CelluleNombre ligne="article" col={0} valeur={nombreOuNull(parCarton)} onEnregistrer={(v) => setParCarton(texteDe(v))} min={0} quantite placeholder="ex. 24" className={`${inp} text-right`} aria-label="Unités par carton" />
          </label>
          <div className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">
            <span>Prix unitaire de référence</span>
            <div className="flex gap-1">
              <input type="hidden" name="devisePrix" value={devise} />
              <input type="hidden" name={devise === "CDF" ? "prixUnitaireCDF" : "prixUnitaireUSD"} value={prix} />
              <CelluleNombre ligne="article" col={1} valeur={prixLu} onEnregistrer={(v) => { setPrix(texteDe(v)); setPrixConverti(false); }} min={0} className={`${inp} text-right`} aria-label={`Prix unitaire ${devise === "CDF" ? "FC" : "USD"}`} />
              <div role="group" aria-label="Devise du prix" className="inline-flex shrink-0 overflow-hidden rounded-md border text-sm">
                <button type="button" onClick={() => changerDevise("USD")} aria-pressed={devise === "USD"} className={`px-2.5 ${devise === "USD" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>$</button>
                <button type="button" onClick={() => changerDevise("CDF")} aria-pressed={devise === "CDF"} className={`px-2.5 ${devise === "CDF" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>FC</button>
              </div>
            </div>
            <span className="text-[11px] tabular-nums">
              {equivalent !== null ? `≈ ${formaterPrix(equivalent, autreDevise)} au taux du jour` : prixLu !== null && prixLu > 0 ? "équivalent : — (taux du jour non défini dans les Paramètres)" : "La devise choisie fait foi ; l'autre s'affiche au taux du jour."}
              {prixConverti && <span className="ml-1 text-amber-800">— converti au taux du jour : vérifiez le prix avant d&apos;enregistrer.</span>}
            </span>
          </div>
          <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">Catégorie
            <select name="categorieId" defaultValue={a.categorieId ?? ""} className={inp}>
              <option value="">— à classer —</option>
              {catsPour.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
            </select>
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">Fournisseur
            <ChoixRecherche options={optionsFour} name="fournisseurId" defaultValue={a.fournisseurId ?? ""} vide="—" aria-label="Fournisseur" className={inp} />
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">Stock minimum
            <input type="hidden" name="stockMinimum" value={seuilMin} />
            <CelluleNombre ligne="article" col={2} valeur={nombreOuNull(seuilMin)} onEnregistrer={(v) => setSeuilMin(texteDe(v))} min={0} quantite className={`${inp} text-right`} aria-label="Stock minimum" />
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground">Seuil urgent
            <input type="hidden" name="seuilUrgent" value={seuilUrgent} />
            <CelluleNombre ligne="article" col={3} valeur={nombreOuNull(seuilUrgent)} onEnregistrer={(v) => setSeuilUrgent(texteDe(v))} min={0} quantite className={`${inp} text-right`} aria-label="Seuil urgent" />
          </label>
        </div>
      </ZoneTableur>
      <p className="mt-2 text-xs text-muted-foreground">Le stock ne se modifie pas ici : il évolue par les mouvements, l&apos;inventaire (comptage) ou la correction d&apos;un stock négatif.</p>
      {!estDirection && <p className="mt-1 text-xs text-amber-800">Seuls les champs changés sont proposés ; l&apos;article ne change qu&apos;après validation de la Direction.</p>}
      <div className="mt-3 flex items-center gap-2">
        <button disabled={isPending} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">{isPending ? "Enregistrement…" : estDirection ? "Enregistrer" : "Envoyer à la Direction"}</button>
        <button type="button" onClick={() => setOuvert(false)} className="text-sm text-muted-foreground underline">Annuler</button>
      </div>
    </form>
  );
}

// Liste d'achat (Stock → Achats & mouvements) : la logique de SAISIE, pure (ni DOM ni React), partagée
// par les deux présentations de l'écran — le tableur (ordinateur) et la vue téléphone (récapitulatif +
// panneau plein écran). UNE source d'état (`Ligne[]`), UNE règle de calcul, UN envoi au serveur :
// les deux vues ne peuvent pas diverger.
//
// Les nombres d'une ligne sont des TEXTES à la française (« 2,5 ») : relus par `nombreDeSaisie` pour
// les calculs, envoyés tels quels au serveur (`decSaisi`). Jamais `Number()` sur un texte de ligne.
import { cleAlnum } from "@/lib/texte";
import { ecrireSaisieNombre, lireSaisieNombre } from "@/lib/nombre";
import { canoniqueVersSaisie, nombreDeSaisie } from "@/lib/saisie-nombre-stock";
import { decisionSortie, type Regles } from "@/components/tableur/navigation";
import { MOIS_FR_COURT } from "@/lib/dates-fr";
import { formaterMontant } from "@/lib/montant";
import { prixProposeEn } from "@/lib/prix-article";

/** `prix` : prix de référence du catalogue dans SA devise (`devisePrix`, absente = USD). */
export type Art = { id: string; designation: string; nomCourt?: string | null; code?: string | null; unite: string | null; domaine: string; prix: string | null; devisePrix?: Devise };
export type Fourn = { id: string; nom: string };
export type Devise = "USD" | "CDF";
export type Domaine = "NOURRITURE" | "BOISSON" | "AUTRE";

/**
 * Une ligne de la liste : article du CATALOGUE (désignation/unité reprises) ou ÉCRITURE LIBRE
 * (nouvel article, créé au catalogue dans le domaine choisi). `devise` : devise de LA LIGNE, envoyée
 * avec elle. `puCatalogue` : prix du catalogue (en USD) d'où vient le PU affiché, tant que la
 * personne ne l'a pas retapé — jamais envoyé, comme le PU lui-même.
 */
export type Ligne = { articleId: string; designation: string; unite: string; domaine: string; qte: string; pu: string; montant: string; devise: Devise; puCatalogue: string | null; fournNom: string; puCatalogueDevise?: Devise };

export const vide = (devise: Devise): Ligne => ({ articleId: "", designation: "", unite: "", domaine: "NOURRITURE", qte: "", pu: "", montant: "", devise, puCatalogue: null, fournNom: "" });
export const quatreVides = (devise: Devise) => [vide(devise), vide(devise), vide(devise), vide(devise)];

/** Ligne où rien n'est saisi : le défaut de devise du haut peut la relabelliser sans toucher un montant. */
export const vierge = (l: Ligne) => !l.articleId && !l.designation.trim() && !l.unite.trim() && !l.qte && !l.pu && !l.montant && !l.fournNom.trim();

/** Ligne que le serveur enregistrera : article ou désignation, et quantité > 0 (même filtre que `entreeListeAchat`). */
export const aEnregistrer = (l: Ligne) => !!(l.articleId || l.designation.trim()) && nombreDeSaisie(l.qte) > 0;

/** Montant automatique d'une ligne : quantité × PU (au centime), vide si l'un manque. */
export const produit = (qte: string, pu: string) => {
  const q = nombreDeSaisie(qte);
  const p = nombreDeSaisie(pu);
  return q > 0 && p > 0 ? ecrireSaisieNombre(Math.round(q * p * 100) / 100) : "";
};

/**
 * Nouveau PU venu du CATALOGUE (bascule de devise, changement d'article). Le montant ne suit que
 * s'il est encore le produit automatique de l'ancien qté × PU (ou vide) : un montant TAPÉ à la
 * main n'est jamais touché — c'est celui du ticket.
 */
export const avecPuCatalogue = (l: Ligne, pu: string, puCatalogue: string | null, puCatalogueDevise?: Devise): Ligne => {
  const montantAuto = l.montant === "" || l.montant === produit(l.qte, l.pu);
  const base = { ...l, pu, puCatalogue, montant: montantAuto ? produit(l.qte, pu) : l.montant };
  if (puCatalogueDevise === "CDF") return { ...base, puCatalogueDevise };
  const { puCatalogueDevise: _, ...sans } = base;
  void _;
  return sans; // catalogue en dollars : la ligne reste celle d'avant (aucun champ de plus)
};

/** Applique un changement à une ligne : PU retapé ⇒ il ne vient plus du catalogue ; quantité ou PU modifiés et PU renseigné ⇒ montant recalculé. */
export function avecChangement(l: Ligne, patch: Partial<Ligne>): Ligne {
  const maj = { ...l, ...patch };
  if ("pu" in patch && !("puCatalogue" in patch)) maj.puCatalogue = null;
  if (("qte" in patch || "pu" in patch) && maj.pu !== "") maj.montant = produit(maj.qte, maj.pu);
  return maj;
}

/**
 * PU du catalogue d'un article, dans la devise de la LIGNE : même devise que le prix de référence →
 * ce prix tel quel ; autre devise → converti au taux du jour (au franc, ou 4 décimales en dollars —
 * src/lib/prix-article.ts) ; sinon rien. `devisePrix` : devise du prix du catalogue (absente = USD).
 */
export function puDuCatalogue(prix: string | null, devise: Devise, taux: number, devisePrix: Devise = "USD"): string | null {
  const p = prix !== null ? Number(prix) : NaN;
  if (!(p > 0)) return null;
  if (devise === devisePrix) return canoniqueVersSaisie(prix);
  const v = prixProposeEn(devisePrix === "CDF" ? { devisePrix: "CDF", prixUnitaireUSD: null, prixUnitaireCDF: prix } : { devisePrix: "USD", prixUnitaireUSD: prix }, devise, taux);
  return v === null ? null : ecrireSaisieNombre(v);
}

/**
 * Changement d'article : `puCatalogue` repart TOUJOURS du nouvel article (ou devient nul s'il n'a
 * pas de prix) — jamais celui de l'ancien. Un PU tapé à la main reste s'il n'y a rien à reprendre ;
 * un PU qui venait de l'ancien article s'efface avec lui. `a` absent = « — libre — ».
 */
export function avecArticle(l: Ligne, a: Art | undefined, taux: number): Ligne {
  const base = a
    ? { ...l, articleId: a.id, designation: a.designation, unite: a.unite ?? "", domaine: a.domaine }
    : { ...l, articleId: "", designation: "", unite: "" };
  const pu = a ? puDuCatalogue(a.prix, l.devise, taux, a.devisePrix) : null;
  if (pu !== null) return avecPuCatalogue(base, pu, a!.prix, a!.devisePrix);
  return l.puCatalogue !== null ? avecPuCatalogue(base, "", null) : { ...base, puCatalogue: null };
}

/**
 * Change la devise d'UNE ligne : les nombres tapés restent tels quels — ils sont ceux du ticket, seule
 * leur devise change (et un second changement revient exactement en arrière). Seul un PU REPRIS DU
 * CATALOGUE (en USD, pas tapé) est converti au taux du jour, pour ne jamais lire « 1,7 FC » ; il repart
 * du prix du catalogue au retour en USD. Le montant ne le suit que s'il était encore automatique.
 */
export function avecDevise(l: Ligne, d: Devise, taux: number): Ligne {
  if (l.devise === d) return l;
  const prix = l.puCatalogue !== null ? Number(l.puCatalogue) : NaN;
  if (taux > 0 && prix > 0) {
    const pu = puDuCatalogue(l.puCatalogue, d, taux, l.puCatalogueDevise ?? "USD") ?? "";
    return { ...avecPuCatalogue(l, pu, l.puCatalogue, l.puCatalogueDevise), devise: d };
  }
  return avecChangement(l, { devise: d });
}

/**
 * Le changement de devise laisserait tel quel le montant de cette ligne : il est TAPÉ (celui du ticket), ou issu d'un
 * PU tapé. Seul un montant encore automatique à partir d'un PU du catalogue est converti au taux (`avecDevise`).
 */
export function montantNonConverti(l: Ligne, taux: number): boolean {
  if (!(nombreDeSaisie(l.montant) > 0)) return false;
  const prix = l.puCatalogue !== null ? Number(l.puCatalogue) : NaN;
  return !(taux > 0 && prix > 0 && l.montant === produit(l.qte, l.pu));
}
/** Lignes qui changeraient de devise SANS que leur montant soit converti — ce que l'on fait confirmer. */
export const lignesAConfirmer = (lignes: readonly Ligne[], d: Devise, taux: number) => lignes.filter((l) => l.devise !== d && montantNonConverti(l, taux));
/** « 28,00 $ deviendra 28 FC » : le nombre reste, seule la devise change. */
export const phraseDevise = (l: Ligne, d: Devise) => `${formaterMontant(nombreDeSaisie(l.montant), l.devise)} deviendra ${formaterMontant(nombreDeSaisie(l.montant), d)}`;

/** Brouillon repris : un article qui n'est plus au catalogue devient une ligne LIBRE (la désignation est gardée). */
export const sansArticleDisparu = (l: Ligne, existe: (id: string) => boolean): Ligne => (l.articleId && !existe(l.articleId) ? { ...l, articleId: "", puCatalogue: null } : l);

/**
 * L'ENVOI AU SERVEUR — le même pour les deux vues, construit depuis l'état (jamais relu dans le DOM) :
 * `date`, `origine`, puis, pour CHAQUE ligne et dans l'ordre, `articleId`, `designation`, `unite`,
 * `domaine`, `quantite`, `montant`, `devise`, `fournisseurNom`, `fournisseurId`. Le PU n'est jamais
 * envoyé. Le serveur lit ces champs par position (`entreeListeAchat`).
 */
export function construireFormData(e: { date: string; origine: string; lignes: readonly Ligne[]; idFourn: (nom: string) => string }): FormData {
  const fd = new FormData();
  fd.append("date", e.date);
  fd.append("origine", e.origine);
  for (const l of e.lignes) {
    fd.append("articleId", l.articleId);
    fd.append("designation", l.designation);
    fd.append("unite", l.unite);
    fd.append("domaine", l.domaine);
    fd.append("quantite", l.qte);
    fd.append("montant", l.montant);
    fd.append("devise", l.devise);
    fd.append("fournisseurNom", l.fournNom);
    fd.append("fournisseurId", e.idFourn(l.fournNom));
  }
  return fd;
}

/** Nom tapé → fournisseur connu (même clé que le serveur : casse et accents ignorés). */
export const indexFournisseurs = (fournisseurs: readonly Fourn[]) => new Map(fournisseurs.map((f) => [cleAlnum(f.nom), f.id]));

/** Fournisseurs proches de ce qui est tapé (touche pour choisir) ; rien si le nom est déjà exactement un fournisseur connu. */
export function fournisseursProches(saisie: string, fournisseurs: readonly Fourn[], max = 5): Fourn[] {
  const cle = cleAlnum(saisie);
  if (!cle || fournisseurs.some((f) => cleAlnum(f.nom) === cle)) return [];
  return fournisseurs.filter((f) => cleAlnum(f.nom).includes(cle)).slice(0, max);
}

// ── Lecture d'un champ de nombre de la vue téléphone ─────────────────────────────────────────────

export type LectureChamp = { ok: true; valeur: number | null } | { ok: false; message: string };
/** Même lecture et mêmes messages que la case du tableur (`decisionSortie`) : vide → null, illisible ou ambigu → message. */
export function lireChamp(texte: string, regles: Regles = { min: 0 }): LectureChamp {
  const d = decisionSortie(texte, null, regles);
  if (d.type === "invalide") return { ok: false, message: d.message };
  if (d.type === "inchange") return { ok: true, valeur: null };
  return { ok: true, valeur: d.valeur };
}

/** Texte de saisie → texte canonique à la française (« 1 250,5 » → « 1250,5 »), pour ranger le champ dans la ligne. */
export const canonique = (texte: string): string => {
  const l = lireSaisieNombre(texte);
  return l.ok ? ecrireSaisieNombre(l.valeur) : texte;
};

/** Ce que le panneau d'un article refuse, champ par champ (vide = valide). */
export type ErreursPanneau = { article?: string; qte?: string; pu?: string; montant?: string };
export function erreursDe(l: Ligne): ErreursPanneau {
  const e: ErreursPanneau = {};
  if (!l.articleId && !l.designation.trim()) e.article = "Choisissez un article du catalogue, ou saisissez un nouvel article.";
  const q = lireChamp(l.qte, { min: 0, quantite: true });
  if (!q.ok) e.qte = q.message;
  else if (!(q.valeur !== null && q.valeur > 0)) e.qte = "Indiquez une quantité plus grande que 0.";
  const p = lireChamp(l.pu);
  if (!p.ok) e.pu = p.message;
  const m = lireChamp(l.montant);
  if (!m.ok) e.montant = m.message;
  return e;
}
export const sansErreur = (e: ErreursPanneau) => !e.article && !e.qte && !e.pu && !e.montant;

/** Ligne du panneau rangée dans la liste : nombres au format canonique, fournisseur rogné. */
export const rangee = (l: Ligne): Ligne => ({ ...l, qte: canonique(l.qte), pu: canonique(l.pu), montant: canonique(l.montant), designation: l.designation.trim(), unite: l.unite.trim(), fournNom: l.fournNom.trim() });

// ── Affichage ───────────────────────────────────────────────────────────────────────────────────

/** « 2026-10-07 » → « 7 oct. 2026 » (lu dans la chaîne : aucun calendrier de l'appareil). */
export function jourCourt(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${MOIS_FR_COURT[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

// ── Brouillon local (téléphone) ────────────────────────────────────────────────────────────────

export type Brouillon = { v: 1; jour: string; date: string; origine: string; deviseDefaut: Devise; lignes: Ligne[] };
export const cleBrouillon = (compteId: string) => `liste-achat:brouillon:${compteId}`;
const MAX_LIGNES = 200;

export function serialiserBrouillon(b: Omit<Brouillon, "v">): string {
  return JSON.stringify({ v: 1, ...b, lignes: b.lignes.filter((l) => !vierge(l)) } satisfies Brouillon);
}

const texte = (v: unknown, max = 300): string => (typeof v === "string" ? v.slice(0, max) : "");
const estDevise = (v: unknown): v is Devise => v === "USD" || v === "CDF";

/** Relit un brouillon : forme et valeurs revalidées (un stockage ancien, tronqué ou trafiqué ne doit jamais casser l'écran). Rien d'exploitable → null. */
export function lireBrouillon(brut: string | null): Brouillon | null {
  if (!brut) return null;
  let o: unknown;
  try { o = JSON.parse(brut); } catch { return null; }
  if (!o || typeof o !== "object") return null;
  const b = o as Record<string, unknown>;
  if (b.v !== 1 || !Array.isArray(b.lignes)) return null;
  const lignes: Ligne[] = [];
  for (const x of b.lignes.slice(0, MAX_LIGNES)) {
    if (!x || typeof x !== "object") continue;
    const r = x as Record<string, unknown>;
    const l: Ligne = {
      articleId: texte(r.articleId, 60), designation: texte(r.designation), unite: texte(r.unite, 40),
      domaine: ["NOURRITURE", "BOISSON", "AUTRE"].includes(String(r.domaine)) ? String(r.domaine) : "NOURRITURE",
      qte: texte(r.qte, 40), pu: texte(r.pu, 40), montant: texte(r.montant, 40),
      devise: estDevise(r.devise) ? r.devise : "USD",
      puCatalogue: typeof r.puCatalogue === "string" ? r.puCatalogue.slice(0, 40) : null,
      ...(r.puCatalogueDevise === "CDF" ? { puCatalogueDevise: "CDF" as const } : {}),
      fournNom: texte(r.fournNom),
    };
    if (!vierge(l)) lignes.push(l);
  }
  if (lignes.length === 0) return null;
  return {
    v: 1,
    jour: /^\d{4}-\d{2}-\d{2}$/.test(String(b.jour)) ? String(b.jour) : "",
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(b.date)) ? String(b.date) : "",
    origine: texte(b.origine),
    deviseDefaut: estDevise(b.deviseDefaut) ? b.deviseDefaut : "USD",
    lignes,
  };
}

/** Lecture / écriture / effacement du brouillon : le stockage peut être absent ou refusé (mode privé, quota) — jamais d'exception. */
export const brouillonLocal = {
  lire(compteId: string): Brouillon | null {
    try { return lireBrouillon(window.localStorage.getItem(cleBrouillon(compteId))); } catch { return null; }
  },
  ecrire(compteId: string, b: Omit<Brouillon, "v">) {
    try { window.localStorage.setItem(cleBrouillon(compteId), serialiserBrouillon(b)); } catch { /* stockage indisponible : la saisie continue sans brouillon */ }
  },
  effacer(compteId: string) {
    try { window.localStorage.removeItem(cleBrouillon(compteId)); } catch { /* idem */ }
  },
};

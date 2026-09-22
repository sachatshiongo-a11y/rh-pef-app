import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Garde-fou de source : aucun fichier de l'application ne doit peindre lui-même un bouton
 * d'approbation / de refus / de validation (couleur, forme, icône en dur). Le seul chemin
 * autorisé est d'importer BoutonApprouver / BoutonRefuser / BoutonValider / BoutonDanger
 * (ou, pour une étape intermédiaire qui n'est ni l'un ni l'autre, BoutonNeutre /
 * CLASSES_NEUTRE) depuis "@/components/action-buttons".
 *
 * DEUX règles, parce qu'un seul angle de vue laissait passer un cas entier :
 *
 * 1. LE MOT — pour chaque .tsx de src/app, on repère les <button ...> littéraux et on
 *    regarde si « Approuver », « Refuser », « Valider » ou « Accepter » (sans égard à la
 *    casse) apparaît entre l'ouverture de la balise et son </button> — c'est-à-dire dans sa
 *    className ou dans son texte. Si oui, le fichier doit importer
 *    "@/components/action-buttons".
 *
 * 2. LA COULEUR — la règle 1 ne cherche que des balises <button LITTÉRALES. Or un composant
 *    enveloppe (ConfirmSubmitButton) rend son propre <button> avec une className fournie par
 *    l'appelant : n'importe qui pouvait peindre un bouton de décision à la main à travers lui
 *    sans jamais faire rougir le test. La règle 2 regarde donc l'APLAT de décision
 *    (bg-success / bg-destructive, sans préfixe de variante ni opacité) partout dans src/,
 *    qu'il soit posé sur un <button> littéral OU passé à un composant dont le nom se termine
 *    par « Button » ou « Btn ».
 *
 *    Elle ne vise QUE les cliquables : les dizaines de pastilles, badges et libellés d'état
 *    (<span>, <div>) qui emploient ces mêmes couleurs ne sont pas regardés. Elle ignore aussi
 *    `hover:bg-destructive/10` & co. : un survol ou une teinte à l'opacité n'est pas un aplat.
 *
 * Ce que les règles NE détectent PAS (limite assumée, pas cachée) : un bouton peint à la main
 * dont le libellé n'utilise aucun des mots surveillés ET qui n'emploie pas ces deux couleurs
 * (une icône seule en bg-primary, par exemple), ou une className passée à un composant dont
 * le nom ne finit ni par « Button » ni par « Btn ».
 */

const RACINE_SRC = join(__dirname, "..");
const RACINE_APP = join(RACINE_SRC, "app");

// Exceptions documentées, pas des oublis : ces boutons emploient « Valider » au sens de
// « confirmer/enregistrer un formulaire », jamais pour approuver ou refuser une demande
// faite par quelqu'un d'autre — aucun n'a de bouton "Refuser" en vis-à-vis.
const EXCEPTIONS = new Set<string>([
  // Couleur qui code le SENS du mouvement (entrée = vert, sortie = rouge), pas une décision.
  "(stock)/stock/mouvements/mouvements-client.tsx",
  // Enregistre la réception d'un bon de commande déjà validé par la Direction ; bg-primary,
  // pas bg-success — aucun rapport avec l'approbation du bon lui-même (déjà convertie).
  "(stock)/stock/commandes/[id]/reception-client.tsx",
  // Enregistre une entrée en stock (formulaire de saisie) ; bg-primary, aucun bouton
  // "Refuser" en vis-à-vis — ce n'est l'approbation d'aucune demande.
  "(stock)/stock/entree/entree-client.tsx",
]);

/**
 * Exceptions de la règle 2 — chemins relatifs à src/. CHAQUE entrée porte une raison écrite
 * en clair : une exception sans raison est un oubli déguisé, et le test ci-dessous la refuse.
 */
const EXCEPTIONS_COULEUR: { fichier: string; raison: string }[] = [
  {
    fichier: "app/(stock)/stock/mouvements/mouvements-client.tsx",
    raison:
      "Le vert et le rouge codent ici le SENS du mouvement (Entrée / Sortie), pas une décision : " +
      "ce sont deux onglets d'un même sélecteur, et le bouton d'envoi reprend la couleur du sens choisi.",
  },
  {
    fichier: "app/(app)/employes/[id]/fin-contrat-form.tsx",
    raison:
      "« Terminer le contrat & archiver » : aplat destructif sur une rupture irréversible, pas le refus " +
      "d'une demande faite par quelqu'un d'autre — aucun bouton en vis-à-vis. Hors périmètre du lot " +
      "boutons du 2026-09-22 ; à reprendre si la famille s'étend un jour aux actions destructives.",
  },
  {
    fichier: "app/(app)/employes/[id]/dossier.tsx",
    raison:
      "« Re-figer l'exemplaire » : aplat destructif sur un écrasement de document opposable, pas une " +
      "approbation ni un refus. Même arbitrage que fin-contrat-form.tsx — hors périmètre du lot du 2026-09-22.",
  },
];

function listerFichiersTsx(dir: string): string[] {
  const resultat: string[] = [];
  for (const entree of readdirSync(dir)) {
    const chemin = join(dir, entree);
    const info = statSync(chemin);
    if (info.isDirectory()) resultat.push(...listerFichiersTsx(chemin));
    else if (entree.endsWith(".tsx")) resultat.push(chemin);
  }
  return resultat;
}

const MOT_SURVEILLE = /\b(Approuver|Refuser|Valider|Accepter)\b/i;

/**
 * true si un <button> littéral porte un mot surveillé dans sa className OU dans son texte.
 * La fenêtre s'arrête au </button> fermant : elle ne déborde PAS sur ce qui suit le bouton.
 * (Sans cette borne, un libellé d'état « À valider » posé dans la cellule voisine d'un tableau
 * faisait accuser le bouton d'à côté — MOT_SURVEILLE ignore la casse depuis le 2026-09-22.)
 */
function contientBoutonPeintALaMain(source: string): boolean {
  const re = /<button\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    const fermeture = source.indexOf("</button>", m.index);
    const fin = fermeture === -1 ? m.index + 400 : fermeture;
    if (MOT_SURVEILLE.test(source.slice(m.index, fin))) return true;
  }
  return false;
}

// Aplat de décision : bg-success / bg-destructive NU. Exclut `hover:bg-success` (préfixe de
// variante, donc un `:` avant) et `bg-destructive/10` (opacité, donc un `/` après) : une
// teinte de survol ou de fond n'est pas l'aplat plein d'un bouton de décision.
const APLAT_DECISION = /(?<![\w:-])bg-(?:success|destructive)(?![\w/-])/;

// <button ...> littéral, ou <MonTrucButton ...> / <MonTrucBtn ...> (composant-enveloppe).
const OUVERTURE_CLIQUABLE = /<(button|[A-Z][A-Za-z0-9_]*(?:Button|Btn))\b/g;

/**
 * Renvoie la zone des attributs d'une balise ouvrante : du `<` jusqu'au `>` correspondant,
 * en sautant tout ce qui est entre accolades (une flèche `() => …` dans un onClick contient
 * un `>` qui n'est pas la fin de la balise) et entre guillemets.
 */
function zoneAttributs(source: string, debut: number): string {
  let profondeur = 0;
  let guillemet: string | null = null;
  const fin = Math.min(source.length, debut + 4000);
  for (let i = debut; i < fin; i++) {
    const c = source[i];
    if (guillemet) {
      if (c === guillemet && source[i - 1] !== "\\") guillemet = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { guillemet = c; continue; }
    if (c === "{") { profondeur++; continue; }
    if (c === "}") { profondeur--; continue; }
    if (c === ">" && profondeur === 0) return source.slice(debut, i + 1);
  }
  return source.slice(debut, fin);
}

/** Balises cliquables (littérales ou composants-enveloppes) portant un aplat de décision. */
function cliquablesAvecAplatDecision(source: string): string[] {
  const trouves: string[] = [];
  const re = new RegExp(OUVERTURE_CLIQUABLE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    const zone = zoneAttributs(source, m.index);
    if (APLAT_DECISION.test(zone)) trouves.push(m[1]);
  }
  return trouves;
}

describe("action-buttons — garde-fou de source", () => {
  const fichiersApp = listerFichiersTsx(RACINE_APP);
  const fichiersSrc = listerFichiersTsx(RACINE_SRC);

  it("règle 1 — tout <button> Approuver/Refuser/Valider peint à la main importe @/components/action-buttons", () => {
    const violations: string[] = [];
    for (const chemin of fichiersApp) {
      const relatif = relative(RACINE_APP, chemin).replace(/\\/g, "/");
      if (EXCEPTIONS.has(relatif)) continue;
      const source = readFileSync(chemin, "utf-8");
      if (!contientBoutonPeintALaMain(source)) continue;
      if (!source.includes("@/components/action-buttons")) violations.push(relatif);
    }
    expect(violations, `bouton(s) peint(s) à la main hors de la source unique : ${violations.join(", ")}`).toEqual([]);
  });

  it("règle 2 — aucun cliquable hors action-buttons.tsx ne porte bg-success / bg-destructive, même à travers un composant-enveloppe", () => {
    // Les deux seuls fichiers autorisés à poser ces couleurs sur un cliquable : la source
    // unique elle-même, et la primitive shadcn dont elle hérite la forme.
    const AUTORISES = new Set(["components/action-buttons.tsx", "components/ui/button.tsx"]);
    const exceptees = new Set(EXCEPTIONS_COULEUR.map((e) => e.fichier));

    const violations: string[] = [];
    for (const chemin of fichiersSrc) {
      const relatif = relative(RACINE_SRC, chemin).replace(/\\/g, "/");
      if (AUTORISES.has(relatif) || exceptees.has(relatif)) continue;
      const balises = cliquablesAvecAplatDecision(readFileSync(chemin, "utf-8"));
      if (balises.length > 0) violations.push(`${relatif} (<${[...new Set(balises)].join(">, <")}>)`);
    }
    expect(
      violations,
      `aplat de décision peint à la main hors de la source unique : ${violations.join(" | ")}`,
    ).toEqual([]);
  });

  it("la règle 2 se falsifie — elle voit un aplat, sur un <button> comme à travers une enveloppe", () => {
    // Si ce test passait au vert avec du code fautif, la règle ne garderait rien.
    expect(cliquablesAvecAplatDecision(`<button className="bg-success px-4">Clôturer</button>`)).toEqual(["button"]);
    expect(
      cliquablesAvecAplatDecision(`<ConfirmSubmitButton message="x" className="rounded-md bg-success px-4 py-2 text-white">Clôturer</ConfirmSubmitButton>`),
    ).toEqual(["ConfirmSubmitButton"]);
    expect(cliquablesAvecAplatDecision(`<SupprimerBtn className="bg-destructive">x</SupprimerBtn>`)).toEqual(["SupprimerBtn"]);
    // …et elle ne voit PAS ce qu'elle ne doit pas voir : pastilles, survols, teintes, onClick.
    expect(cliquablesAvecAplatDecision(`<span className="bg-success/10 text-success">Validé</span>`)).toEqual([]);
    expect(cliquablesAvecAplatDecision(`<div className="rounded-full bg-destructive px-2">3</div>`)).toEqual([]);
    expect(cliquablesAvecAplatDecision(`<button className="border hover:bg-destructive/10">Supprimer</button>`)).toEqual([]);
    expect(cliquablesAvecAplatDecision(`<button onClick={() => f(a > b)} className="border">x</button>`)).toEqual([]);
  });

  it("la règle 1 se falsifie — elle voit le mot dans le bouton, et pas celui du voisin", () => {
    expect(contientBoutonPeintALaMain(`<button className="bg-success">Valider</button>`)).toBe(true);
    expect(contientBoutonPeintALaMain(`<button className="bg-success">approuver la demande</button>`)).toBe(true);
    expect(contientBoutonPeintALaMain(`<button className="border">Accepter</button>`)).toBe(true);
    // Un libellé d'état APRÈS le bouton n'accuse pas le bouton.
    expect(
      contientBoutonPeintALaMain(`<button className="border">Enregistrer</button></form></td><td><span>À valider</span></td>`),
    ).toBe(false);
  });

  it("chaque exception est encore vraie — fichier existant ET raison écrite", () => {
    // Si ce test échoue, une exception ne correspond plus à un fichier réel (le garde-fou
    // protégerait un fichier qui n'existe pas, silencieusement inutile), ou bien quelqu'un a
    // ajouté une dispense sans dire pourquoi — une exception sans raison est un oubli déguisé.
    for (const relatif of EXCEPTIONS) {
      const chemin = join(RACINE_APP, relatif);
      expect(() => statSync(chemin), `exception obsolète : ${relatif} n'existe plus`).not.toThrow();
    }
    for (const { fichier, raison } of EXCEPTIONS_COULEUR) {
      expect(() => statSync(join(RACINE_SRC, fichier)), `exception obsolète : ${fichier} n'existe plus`).not.toThrow();
      expect(raison.trim().length, `exception sans raison écrite : ${fichier}`).toBeGreaterThan(20);
    }
  });
});

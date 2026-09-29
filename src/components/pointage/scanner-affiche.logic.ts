// Les DÉCISIONS du scanner d'affiche — module pur, testé (`scanner-affiche.logic.test.ts`).
//
// Ce dépôt n'a pas de DOM en test : la caméra, jsQR et la géolocalisation ne tournent jamais sous
// vitest. Tout ce qui DÉCIDE (quand la caméra doit tourner, ce qu'un QR veut dire, quel écran
// montrer pour quelle réponse du serveur, comment lire une erreur d'appareil) vit donc ici ; le
// composant `scanner-affiche.tsx` ne fait que brancher les appareils sur ces fonctions.
//
// ⚠️ Importé par un composant CLIENT : aucune dépendance serveur. `ResultatScan` n'est importé
// qu'en TYPE (effacé à la compilation) — `pointage-scan.ts` est `server-only` et tire
// `pointage-code.ts` (node:crypto), qui ne doit jamais entrer dans le paquet du navigateur.

import type { ResultatScan } from "@/lib/pointage-scan";
import {
  PAUSE_PAR_DEFAUT_MIN,
  libelleMotif,
  libellePause,
  lireCodeDepuisQr,
  type PositionScan,
  type VerdictPosition,
} from "@/lib/pointage-qr";
import { heureKinshasa } from "@/lib/heure-kinshasa";
import { formaterNombre } from "@/lib/montant";

// ── Messages ─────────────────────────────────────────────────────────────────
export const MESSAGE_QR_ETRANGER = "Ce n'est pas l'affiche de pointage.";
export const MESSAGE_JOURNEE_COMPLETE = "Votre journée est déjà complète.";
/** L'heure affichée est celle du serveur : le dire, pour qu'un téléphone mal réglé ne sème pas le doute. */
export const MENTION_HEURE_SERVEUR = "Heure du serveur, pas celle du téléphone.";
/** Position loin du restaurant, ou trop floue pour conclure. */
export const A_VERIFIER_HORS_RESTAURANT = "À vérifier : position hors du restaurant";
/** Position refusée ou indisponible (8 s dépassées, pas de GPS). */
export const A_VERIFIER_NON_TRANSMISE = "À vérifier : position non transmise";
export const SUITE_A_VERIFIER = "Le pointage est enregistré ; la Direction le vérifiera.";
export const LIBELLE_ANNULER = "Annuler ce pointage";
export const MESSAGE_SCAN_REPETE = "Ce nouveau scan n'a rien changé.";
export const MESSAGE_JOURNEE_ENREGISTREE = "Journée enregistrée dans vos présences et vos heures.";
/** Départ clos, mais un congé approuvé couvre ce jour : rien n'a été écrit aux présences ni aux heures. */
export const MESSAGE_DEPART_JOUR_DE_CONGE =
  "Un congé est approuvé pour ce jour : vos heures n'ont pas été comptées dans vos présences.";
/** La requête n'a pas abouti : on ne sait pas si le serveur l'a reçue. Un nouveau scan le dira. */
export const MESSAGE_CONNEXION_PERDUE =
  "La connexion a échoué avant la réponse. Scannez de nouveau l'affiche pour savoir où en est votre pointage.";

// ── Réglages des appareils ───────────────────────────────────────────────────
export const CONTRAINTES_CAMERA = { video: { facingMode: "environment" }, audio: false } as const;
/** Une image lue toutes les 200 ms : ~5 par seconde, sur le fil principal (jsQR, sans worker). */
export const INTERVALLE_LECTURE_MS = 200;
/** Largeur maximale de l'image donnée à jsQR : au-delà, la lecture ralentit sans lire mieux. */
export const LARGEUR_LECTURE_MAX = 640;
/**
 * Plafond de l'attente de la position : 8 s (décision de la Direction du 2026-09-29 — le pointage
 * ne doit pas faire attendre). Le `timeout` du navigateur ne court qu'APRÈS l'accord de
 * permission : une invite laissée ouverte ferait attendre le salarié indéfiniment, d'où ce plafond
 * à nous. Au-delà, le pointage part SANS position et sera « à vérifier ».
 */
export const DELAI_MAX_POSITION_MS = 8_000;
export const OPTIONS_GEOLOCALISATION = { enableHighAccuracy: true, timeout: DELAI_MAX_POSITION_MS, maximumAge: 0 } as const;
/** Une position demandée plus tôt que ceci avant le scan est redemandée. */
export const FRAICHEUR_POSITION_MS = 30_000;
/** La valeur proposée dans le champ « Ma pause du jour » : la pause par défaut du serveur. */
export const PAUSE_DEFAUT_MIN = PAUSE_PAR_DEFAUT_MIN;

// ── Phases et écrans ─────────────────────────────────────────────────────────
/**
 * `annulableMs` : temps restant pour « Annuler ce pointage » AU MOMENT de la réponse du serveur
 * (mesuré à son heure, jamais à celle du téléphone) ; le composant retire le bouton à l'échéance.
 * `erreur` : le refus d'une annulation ou d'une pause, affiché sous l'écran.
 */
export type Ecran =
  | {
      type: "ARRIVEE";
      scanId: string;
      titre: string;
      detail: string | null;
      avertissement: string | null;
      motif: string | null;
      annulableMs: number;
      erreur: string | null;
    }
  | {
      type: "DEPART";
      scanId: string;
      titre: string;
      detail: string;
      /** Faux quand un congé approuvé a primé : départ clos, mais rien aux présences ni aux heures. */
      heuresComptees: boolean;
      avertissement: string | null;
      motif: string | null;
      annulableMs: number;
      /** La pause par défaut peut encore être remplacée par celle du salarié (facultatif). */
      pauseModifiable: boolean;
      erreur: string | null;
    }
  | {
      type: "PAUSE_ENREGISTREE";
      titre: string;
      detail: string;
      heuresComptees: boolean;
      avertissement: string | null;
      motif: string | null;
    }
  | { type: "COMPLETE"; titre: string; detail: string }
  | { type: "INFO"; titre: string }
  | { type: "ERREUR"; titre: string };

export type Phase =
  | { phase: "VISEE"; avis: string | null } // caméra ouverte ; `avis` = QR étranger vu
  | { phase: "CAMERA_INDISPONIBLE"; message: string }
  | { phase: "ENVOI" } // code lu (caméra ou adresse) : position puis serveur
  | { phase: "ECRAN"; ecran: Ecran };

/**
 * Sans code → la caméra ; avec le code de l'affiche (`/scan?c=…`) → l'ENVOI, sans geste (décision
 * de la Direction du 2026-09-29 : « scanner = pointer »). L'envoi part du SCRIPT de la page, après
 * son chargement — jamais de la requête GET : un aperçu de lien ou un préchargement ne pointe
 * rien. Les garde-fous qui remplacent le bouton sont côté serveur : scan répété sous 10 min = rien
 * de nouveau ; « Annuler ce pointage » pendant 5 min.
 */
export function phaseInitiale(codeInitial?: string): Phase {
  return codeInitial ? { phase: "ENVOI" } : { phase: "VISEE", avis: null };
}

/**
 * La caméra tourne pendant la visée, page au premier plan — et JAMAIS ailleurs. Le composant
 * ouvre la caméra quand ceci devient vrai et arrête toutes les pistes quand ceci devient faux :
 * code lu (→ ENVOI), démontage, page en arrière-plan. Une caméra oubliée vide la batterie et
 * laisse l'indicateur de caméra allumé sur iPhone.
 */
export function cameraDoitTourner(p: Phase, pageVisible: boolean): boolean {
  return p.phase === "VISEE" && pageVisible;
}

/** Arrête toutes les pistes d'un flux. Une piste qui refuse n'empêche pas les suivantes. */
export function arreterPistes(flux: { getTracks(): { stop(): void }[] } | null | undefined): number {
  if (!flux) return 0;
  const pistes = flux.getTracks();
  for (const piste of pistes) {
    try {
      piste.stop();
    } catch {
      // déjà arrêtée : rien à faire
    }
  }
  return pistes.length;
}

/** Ce que veut dire un QR lu : le code de NOTRE affiche, ou un avis (et on continue de viser). */
export function lectureQr(contenu: string, origines: readonly string[]): { code: string } | { avis: string } {
  const code = lireCodeDepuisQr(contenu, origines);
  return code ? { code } : { avis: MESSAGE_QR_ETRANGER };
}

/** Taille de l'image donnée à jsQR (réduite, proportions gardées) ; `null` tant que la vidéo n'a pas d'image. */
export function dimensionsLecture(largeurVideo: number, hauteurVideo: number): { largeur: number; hauteur: number } | null {
  if (!(largeurVideo > 0) || !(hauteurVideo > 0)) return null;
  const echelle = Math.min(1, LARGEUR_LECTURE_MAX / largeurVideo);
  return { largeur: Math.round(largeurVideo * echelle), hauteur: Math.round(hauteurVideo * echelle) };
}

// ── Caméra indisponible ──────────────────────────────────────────────────────
export type CauseCamera = "REFUSEE" | "OCCUPEE" | "ABSENTE";

/** Classe une erreur de `getUserMedia` (ou son absence : navigateur trop ancien, page non sécurisée). */
export function causeCameraIndisponible(e: unknown): CauseCamera {
  const nom = typeof e === "object" && e !== null && "name" in e ? String((e as { name: unknown }).name) : "";
  if (nom === "NotAllowedError" || nom === "SecurityError" || nom === "PermissionDeniedError") return "REFUSEE";
  if (nom === "NotReadableError" || nom === "TrackStartError" || nom === "AbortError") return "OCCUPEE";
  return "ABSENTE";
}

const RECOURS_APPAREIL_PHOTO =
  "Vous pouvez aussi scanner l'affiche avec l'appareil photo du téléphone : il ouvrira la page de pointage.";

/** Le message quand la caméra ne s'ouvre pas — toujours le recours appareil photo, jamais un pointage sans scan. */
export function messageCameraIndisponible(cause: CauseCamera): string {
  if (cause === "REFUSEE")
    return `L'accès à la caméra a été refusé. Autorisez la caméra pour cette application dans les réglages du téléphone. ${RECOURS_APPAREIL_PHOTO}`;
  if (cause === "OCCUPEE")
    return `La caméra est utilisée par une autre application. Fermez-la puis réessayez. ${RECOURS_APPAREIL_PHOTO}`;
  return `La caméra n'a pas pu s'ouvrir sur cet appareil. ${RECOURS_APPAREIL_PHOTO}`;
}

// ── Position ─────────────────────────────────────────────────────────────────
export function positionDepuisCoordonnees(c: { latitude: number; longitude: number; accuracy: number }): PositionScan {
  return { lat: c.latitude, lng: c.longitude, precisionM: c.accuracy };
}

/** `GeolocationPositionError.code` : 1 = refusée ; 2 (indisponible), 3 (délai), absente → indisponible. */
export function positionDepuisErreur(code: number | undefined): PositionScan {
  return code === 1 ? { erreur: "REFUSEE" } : { erreur: "INDISPONIBLE" };
}

/** Faut-il redemander la position au moment du scan ? Oui si jamais demandée ou demandée trop tôt. */
export function positionAReprendre(demandeeA: number | null, maintenant: number): boolean {
  return demandeeA === null || maintenant - demandeeA > FRAICHEUR_POSITION_MS;
}

// ── Écrans de résultat ───────────────────────────────────────────────────────
const heure = (iso: string) => heureKinshasa(new Date(iso));
const nombreHeures = (h: number) => formaterNombre(h, { maximumFractionDigits: 2 });

/** « À vérifier : position hors du restaurant / non transmise », et le motif précis en dessous. */
export function avertissementDe(v: VerdictPosition): { avertissement: string | null; motif: string | null } {
  if (v.verdict !== "A_VERIFIER") return { avertissement: null, motif: null };
  const nonTransmise = v.motif === "POSITION_REFUSEE" || v.motif === "POSITION_INDISPONIBLE";
  return { avertissement: nonTransmise ? A_VERIFIER_NON_TRANSMISE : A_VERIFIER_HORS_RESTAURANT, motif: libelleMotif(v) };
}

/** L'écran qui répond à un scan : un par état du serveur, ou le refus lisible tel quel. */
export function ecranDepuisResultat(r: ResultatScan | { erreur: string }): Ecran {
  if ("erreur" in r) return { type: "ERREUR", titre: r.erreur };
  switch (r.etat) {
    case "ARRIVEE":
      return {
        type: "ARRIVEE",
        scanId: r.scanId,
        titre: r.repete ? `Arrivée déjà enregistrée à ${heure(r.heure)}` : `Arrivée enregistrée à ${heure(r.heure)}`,
        detail: r.repete ? MESSAGE_SCAN_REPETE : null,
        ...avertissementDe(r.verdict),
        annulableMs: r.annulableMs,
        erreur: null,
      };
    case "DEPART": {
      const journee = r.presencesEcrites
        ? `${nombreHeures(r.heures)} h de travail, ${libellePause(r.pause)}. ${MESSAGE_JOURNEE_ENREGISTREE}`
        : MESSAGE_DEPART_JOUR_DE_CONGE;
      return {
        type: "DEPART",
        scanId: r.scanId,
        titre: r.repete ? `Départ déjà enregistré à ${heure(r.heure)}` : `Départ enregistré à ${heure(r.heure)}`,
        detail: `Arrivée à ${heure(r.arriveeA)}. ${journee}${r.repete ? ` ${MESSAGE_SCAN_REPETE}` : ""}`,
        heuresComptees: r.presencesEcrites,
        ...avertissementDe(r.verdict),
        annulableMs: r.annulableMs,
        pauseModifiable: r.pauseModifiable,
        erreur: null,
      };
    }
    case "COMPLETE":
      return {
        type: "COMPLETE",
        titre: MESSAGE_JOURNEE_COMPLETE,
        detail: `Arrivée à ${heure(r.arriveeA)}, départ à ${heure(r.departA)}, ${libellePause(r.pause)}.`,
      };
  }
}

/**
 * Après « Annuler ce pointage » : ce qui n'est plus retenu, et comment reprendre — ou l'écran
 * d'origine avec le refus (délai passé, journée corrigée par la Direction…), sans le bouton.
 */
export function ecranApresAnnulation(
  r: { moment: "ARRIVEE" | "DEPART"; heure: string } | { erreur: string },
  origine: Extract<Ecran, { type: "ARRIVEE" | "DEPART" }>,
): Ecran {
  if ("erreur" in r) return { ...origine, annulableMs: 0, erreur: r.erreur };
  const quoi =
    r.moment === "ARRIVEE"
      ? `Votre arrivée de ${heure(r.heure)} n'est plus retenue`
      : `Votre départ de ${heure(r.heure)} n'est plus retenu, votre journée est rouverte`;
  return { type: "INFO", titre: `Pointage annulé. ${quoi} : scannez de nouveau l'affiche pour pointer.` };
}

/**
 * Après la pause saisie : le départ (à l'heure du SCAN) avec la pause du salarié, ou l'écran du
 * départ avec le refus. L'écran dit ce que le serveur a RÉELLEMENT écrit : « Journée enregistrée
 * dans vos présences » seulement si `presencesEcrites` ; sinon (congé approuvé ce jour) il dit que
 * les heures n'ont pas été comptées.
 */
export function ecranApresPause(
  r: { heureFin: string; heures: number; presencesEcrites: boolean; pauseMinutes: number } | { erreur: string },
  depart: Extract<Ecran, { type: "DEPART" }>,
): Ecran {
  if ("erreur" in r) return { ...depart, erreur: r.erreur };
  return {
    type: "PAUSE_ENREGISTREE",
    titre: `Départ enregistré à ${heure(r.heureFin)}`,
    detail: r.presencesEcrites
      ? `Pause de ${r.pauseMinutes} min enregistrée et déduite : ${nombreHeures(r.heures)} h de travail. ${MESSAGE_JOURNEE_ENREGISTREE}`
      : MESSAGE_DEPART_JOUR_DE_CONGE,
    heuresComptees: r.presencesEcrites,
    avertissement: depart.avertissement,
    motif: depart.motif,
  };
}

/** La pause saisie, en minutes entières bornées 0-600 (comme le serveur) ; `null` si illisible. */
export function pauseLue(texte: string): number | null {
  const t = texte.trim();
  if (t === "") return null;
  const n = Number(t.replace(",", "."));
  if (!Number.isFinite(n)) return null;
  return Math.round(Math.max(0, Math.min(600, n)));
}

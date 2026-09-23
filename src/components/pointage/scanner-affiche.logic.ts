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
import { libelleMotif, lireCodeDepuisQr, type PositionScan, type VerdictPosition } from "@/lib/pointage-qr";
import { heureKinshasa } from "@/lib/heure-kinshasa";
import { formaterNombre } from "@/lib/montant";

// ── Messages (repris mot pour mot de la conception) ──────────────────────────
export const MESSAGE_QR_ETRANGER = "Ce n'est pas l'affiche de pointage.";
export const MESSAGE_JOURNEE_COMPLETE = "Votre journée est déjà complète.";
export const MESSAGE_HORS_RESTAURANT =
  "Pointage enregistré. Votre position n'a pas pu confirmer que vous êtes au restaurant : la Direction le vérifiera.";
/** La requête n'a pas abouti : on ne sait pas si le serveur l'a reçue. Un nouveau scan le dira. */
export const MESSAGE_CONNEXION_PERDUE =
  "La connexion a échoué avant la réponse. Scannez de nouveau l'affiche pour savoir où en est votre pointage.";

// ── Réglages des appareils ───────────────────────────────────────────────────
export const CONTRAINTES_CAMERA = { video: { facingMode: "environment" }, audio: false } as const;
/** Une image lue toutes les 200 ms : ~5 par seconde, sur le fil principal (jsQR, sans worker). */
export const INTERVALLE_LECTURE_MS = 200;
/** Largeur maximale de l'image donnée à jsQR : au-delà, la lecture ralentit sans lire mieux. */
export const LARGEUR_LECTURE_MAX = 640;
export const OPTIONS_GEOLOCALISATION = { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 } as const;
/**
 * Plafond de l'attente de la position. Le `timeout` du navigateur ne court qu'APRÈS l'accord de
 * permission : une invite laissée ouverte ferait attendre le salarié indéfiniment.
 */
export const DELAI_MAX_POSITION_MS = 20_000;
/** Une position demandée plus tôt que ceci avant le scan est redemandée. */
export const FRAICHEUR_POSITION_MS = 30_000;
export const PAUSE_DEFAUT_MIN = 30;

// ── Phases et écrans ─────────────────────────────────────────────────────────
export type Ecran =
  | { type: "ARRIVEE"; titre: string; avertissement: string | null; motif: string | null }
  | { type: "DEPART_TROP_TOT"; titre: string; heureArrivee: string }
  | {
      type: "DEPART_A_CONFIRMER";
      scanId: string;
      titre: string;
      detail: string;
      avertissement: string | null;
      motif: string | null;
      erreur: string | null;
    }
  | { type: "DEPART_CONFIRME"; titre: string; detail: string; avertissement: string | null; motif: string | null }
  | { type: "COMPLETE"; titre: string }
  | { type: "INFO"; titre: string }
  | { type: "ERREUR"; titre: string };

export type Phase =
  | { phase: "VISEE"; avis: string | null } // caméra ouverte ; `avis` = QR étranger vu
  | { phase: "CAMERA_INDISPONIBLE"; message: string }
  | { phase: "ENVOI" } // code lu : position puis serveur
  | { phase: "ECRAN"; ecran: Ecran };

/** Sans code → la caméra ; avec le code de l'affiche (`/scan?c=…`) → directement l'envoi. */
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
export function lectureQr(contenu: string, origine: string): { code: string } | { avis: string } {
  const code = lireCodeDepuisQr(contenu, origine);
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

function avertissementDe(v: VerdictPosition): { avertissement: string | null; motif: string | null } {
  return v.verdict === "A_VERIFIER"
    ? { avertissement: MESSAGE_HORS_RESTAURANT, motif: libelleMotif(v) }
    : { avertissement: null, motif: null };
}

/** L'écran qui répond à un scan : un par état du serveur, ou le refus lisible tel quel. */
export function ecranDepuisResultat(r: ResultatScan | { erreur: string }): Ecran {
  if ("erreur" in r) return { type: "ERREUR", titre: r.erreur };
  switch (r.etat) {
    case "ARRIVEE":
      return { type: "ARRIVEE", titre: `Arrivée pointée à ${heure(r.heure)}.`, ...avertissementDe(r.verdict) };
    case "DEPART_TROP_TOT":
      return {
        type: "DEPART_TROP_TOT",
        titre: `Vous avez pointé votre arrivée à ${heure(r.arriveeA)}. Pointer votre départ maintenant ?`,
        heureArrivee: heure(r.arriveeA),
      };
    case "DEPART_A_CONFIRMER":
      return {
        type: "DEPART_A_CONFIRMER",
        scanId: r.scanId,
        titre: `Départ scanné à ${heure(r.heure)}.`,
        detail: `Arrivée à ${heure(r.arriveeA)}. Indiquez votre pause pour clore la journée.`,
        ...avertissementDe(r.verdict),
        erreur: null,
      };
    case "COMPLETE":
      return { type: "COMPLETE", titre: MESSAGE_JOURNEE_COMPLETE };
  }
}

/** « Non, c'était une erreur » au double scan : le serveur n'a RIEN écrit, l'arrivée reste. */
export function ecranDepartRenonce(question: Extract<Ecran, { type: "DEPART_TROP_TOT" }>): Ecran {
  return { type: "INFO", titre: `Rien n'a été enregistré : votre arrivée de ${question.heureArrivee} reste pointée.` };
}

/** Après la pause validée : le départ pointé (à l'heure du SCAN), ou l'écran de pause avec le refus. */
export function ecranApresConfirmation(
  r: { heureFin: string; heures: number } | { erreur: string },
  attente: Extract<Ecran, { type: "DEPART_A_CONFIRMER" }>,
): Ecran {
  if ("erreur" in r) return { ...attente, erreur: r.erreur };
  return {
    type: "DEPART_CONFIRME",
    titre: `Départ pointé à ${heure(r.heureFin)}.`,
    detail: `${formaterNombre(r.heures, { maximumFractionDigits: 2 })} h de travail, pause déduite. Journée enregistrée dans vos présences et vos heures.`,
    avertissement: attente.avertissement,
    motif: attente.motif,
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

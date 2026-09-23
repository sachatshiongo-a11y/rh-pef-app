import { describe, it, expect, vi } from "vitest";
import type { ResultatScan } from "@/lib/pointage-scan";
import {
  CONTRAINTES_CAMERA,
  DELAI_MAX_POSITION_MS,
  FRAICHEUR_POSITION_MS,
  INTERVALLE_LECTURE_MS,
  LIBELLE_POINTER_MAINTENANT,
  MESSAGE_ATTENTE_GESTE,
  MESSAGE_CONNEXION_PERDUE,
  MESSAGE_DEPART_JOUR_DE_CONGE,
  MESSAGE_HORS_RESTAURANT,
  MESSAGE_JOURNEE_COMPLETE,
  MESSAGE_QR_ETRANGER,
  OPTIONS_GEOLOCALISATION,
  PAUSE_DEFAUT_MIN,
  arreterPistes,
  cameraDoitTourner,
  causeCameraIndisponible,
  dimensionsLecture,
  ecranApresConfirmation,
  ecranDepartRenonce,
  ecranDepuisResultat,
  lectureQr,
  messageCameraIndisponible,
  pauseLue,
  phaseApresGeste,
  phaseInitiale,
  positionAReprendre,
  positionDepuisCoordonnees,
  positionDepuisErreur,
  type Ecran,
  type Phase,
} from "./scanner-affiche.logic";

// ─────────────────────────────────────────────────────────────────────────────
// CE DÉPÔT N'A PAS DE DOM EN TEST (`environment: "node"`) : la caméra, jsQR, la géolocalisation et
// les écrans ne tournent jamais ici. Toutes les DÉCISIONS du scanner vivent donc dans
// `scanner-affiche.logic.ts`, exercé ci-dessous ; le composant ne fait que brancher les appareils.
// ─────────────────────────────────────────────────────────────────────────────

const ORIGINE = "https://rh.patesenfolie.cd";

// Instants ISO tels que le serveur les renvoie (UTC) ; Kinshasa = UTC+1.
const ARRIVEE_8H02 = "2026-09-23T07:02:00.000Z";
const DEPART_17H05 = "2026-09-23T16:05:00.000Z";

const AU_RESTO = { verdict: "AU_RESTAURANT", distanceM: 12 } as const;
const LOIN = { verdict: "A_VERIFIER", motif: "LOIN", distanceM: 2300 } as const;

describe("les messages exacts de la conception", () => {
  it("sont repris mot pour mot", () => {
    expect(MESSAGE_QR_ETRANGER).toBe("Ce n'est pas l'affiche de pointage.");
    expect(MESSAGE_JOURNEE_COMPLETE).toBe("Votre journée est déjà complète.");
    expect(MESSAGE_HORS_RESTAURANT).toBe(
      "Pointage enregistré. Votre position n'a pas pu confirmer que vous êtes au restaurant : la Direction le vérifiera.",
    );
  });

  it("les réglages des appareils sont ceux de la conception", () => {
    expect(CONTRAINTES_CAMERA).toEqual({ video: { facingMode: "environment" }, audio: false });
    expect(OPTIONS_GEOLOCALISATION).toEqual({ enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 });
    expect(1000 / INTERVALLE_LECTURE_MS).toBe(5); // ~5 lectures par seconde
    expect(PAUSE_DEFAUT_MIN).toBe(30); // comme l'ancien écran de pointage
    expect(DELAI_MAX_POSITION_MS).toBeGreaterThan(OPTIONS_GEOLOCALISATION.timeout);
  });
});

describe("lectureQr : un QR étranger est refusé, on continue de viser", () => {
  it("notre affiche → son code", () => {
    expect(lectureQr(`${ORIGINE}/scan?c=Abc_123-x`, [ORIGINE])).toEqual({ code: "Abc_123-x" });
  });

  it("autre site, même chemin → pas l'affiche", () => {
    expect(lectureQr("https://exemple.com/scan?c=Abc", [ORIGINE])).toEqual({ avis: MESSAGE_QR_ETRANGER });
  });

  it("autre chemin, texte libre, lien de paiement… → pas l'affiche", () => {
    expect(lectureQr(`${ORIGINE}/paie?c=Abc`, [ORIGINE])).toEqual({ avis: MESSAGE_QR_ETRANGER });
    expect(lectureQr("Bonjour", [ORIGINE])).toEqual({ avis: MESSAGE_QR_ETRANGER });
    expect(lectureQr("", [ORIGINE])).toEqual({ avis: MESSAGE_QR_ETRANGER });
  });

  it("l'affiche officielle lue depuis l'autre adresse de l'application → son code", () => {
    expect(lectureQr(`${ORIGINE}/scan?c=Abc`, ["https://rh-pef.onrender.com", ORIGINE])).toEqual({ code: "Abc" });
  });

  it("notre chemin mais sans code (ou code vide) → pas l'affiche", () => {
    expect(lectureQr(`${ORIGINE}/scan`, [ORIGINE])).toEqual({ avis: MESSAGE_QR_ETRANGER });
    expect(lectureQr(`${ORIGINE}/scan?c=`, [ORIGINE])).toEqual({ avis: MESSAGE_QR_ETRANGER });
  });
});

describe("cameraDoitTourner : la caméra ne vit QUE pendant la visée, page au premier plan", () => {
  const visee: Phase = { phase: "VISEE", avis: null };
  it("tourne pendant la visée, page visible", () => expect(cameraDoitTourner(visee, true)).toBe(true));
  it("s'arrête quand la page passe en arrière-plan", () => expect(cameraDoitTourner(visee, false)).toBe(false));
  it("s'arrête dès qu'un code est lu (phase d'envoi) et sur tous les écrans de résultat", () => {
    expect(cameraDoitTourner({ phase: "ENVOI" }, true)).toBe(false);
    expect(cameraDoitTourner({ phase: "ECRAN", ecran: { type: "COMPLETE", titre: MESSAGE_JOURNEE_COMPLETE } }, true)).toBe(false);
    expect(cameraDoitTourner({ phase: "CAMERA_INDISPONIBLE", message: "x" }, true)).toBe(false);
  });
  it("le QR étranger laisse la caméra tourner (on continue de viser)", () =>
    expect(cameraDoitTourner({ phase: "VISEE", avis: MESSAGE_QR_ETRANGER }, true)).toBe(true));
});

describe("phaseInitiale : /scan?c=… saute la caméra, mais ne pointe JAMAIS sans geste", () => {
  it("sans code → la caméra", () => {
    expect(phaseInitiale()).toEqual({ phase: "VISEE", avis: null });
    expect(phaseInitiale("")).toEqual({ phase: "VISEE", avis: null });
  });
  it("avec le code de l'affiche → l'ATTENTE du geste, pas l'envoi (un lien ouvert par mégarde ne pointe rien)", () => {
    const p = phaseInitiale("Abc");
    expect(p).toEqual({ phase: "ATTENTE", code: "Abc" });
    expect(p.phase).not.toBe("ENVOI");
  });
  it("pendant l'attente, la caméra ne tourne pas", () =>
    expect(cameraDoitTourner(phaseInitiale("Abc"), true)).toBe(false));
  it("le geste « Pointer maintenant » fait passer de l'attente à l'envoi — et seulement de l'attente", () => {
    expect(phaseApresGeste(phaseInitiale("Abc"))).toEqual({ phase: "ENVOI" });
    const visee: Phase = { phase: "VISEE", avis: null };
    expect(phaseApresGeste(visee)).toBe(visee);
  });
  it("le message d'attente dit que rien n'est encore enregistré, et nomme le bouton", () => {
    expect(MESSAGE_ATTENTE_GESTE).toMatch(/Rien n'est encore enregistré/);
    expect(MESSAGE_ATTENTE_GESTE).toContain(`« ${LIBELLE_POINTER_MAINTENANT} »`);
    expect(LIBELLE_POINTER_MAINTENANT).toBe("Pointer maintenant");
  });
});

describe("arreterPistes : TOUTES les pistes sont arrêtées", () => {
  it("arrête chaque piste du flux et dit combien", () => {
    const pistes = [{ stop: vi.fn() }, { stop: vi.fn() }];
    expect(arreterPistes({ getTracks: () => pistes })).toBe(2);
    for (const p of pistes) expect(p.stop).toHaveBeenCalledTimes(1);
  });
  it("sans flux (caméra jamais ouverte) : rien à faire, sans planter", () => {
    expect(arreterPistes(null)).toBe(0);
    expect(arreterPistes(undefined)).toBe(0);
  });
  it("une piste qui refuse de s'arrêter n'empêche pas d'arrêter les suivantes", () => {
    const derniere = { stop: vi.fn() };
    const pistes = [{ stop: () => { throw new Error("déjà arrêtée"); } }, derniere];
    expect(arreterPistes({ getTracks: () => pistes })).toBe(2);
    expect(derniere.stop).toHaveBeenCalledTimes(1);
  });
});

describe("la position du téléphone", () => {
  it("coordonnées → PositionScan avec sa précision", () => {
    expect(positionDepuisCoordonnees({ latitude: -4.32, longitude: 15.31, accuracy: 18 })).toEqual({
      lat: -4.32, lng: 15.31, precisionM: 18,
    });
  });
  it("erreur code 1 (PERMISSION_DENIED) → REFUSEE", () =>
    expect(positionDepuisErreur(1)).toEqual({ erreur: "REFUSEE" }));
  it("autres erreurs (indisponible, délai dépassé), ou pas de géolocalisation du tout → INDISPONIBLE", () => {
    expect(positionDepuisErreur(2)).toEqual({ erreur: "INDISPONIBLE" });
    expect(positionDepuisErreur(3)).toEqual({ erreur: "INDISPONIBLE" });
    expect(positionDepuisErreur(undefined)).toEqual({ erreur: "INDISPONIBLE" });
  });
  it("une position demandée il y a trop longtemps est redemandée au moment du scan", () => {
    expect(positionAReprendre(null, 1_000)).toBe(true);
    expect(positionAReprendre(1_000, 1_000 + FRAICHEUR_POSITION_MS)).toBe(false);
    expect(positionAReprendre(1_000, 1_000 + FRAICHEUR_POSITION_MS + 1)).toBe(true);
  });
});

describe("la caméra refusée ou absente : jamais de bouton de pointage, le chemin appareil photo", () => {
  const err = (name: string) => Object.assign(new Error(name), { name });
  it("classe les erreurs de getUserMedia", () => {
    expect(causeCameraIndisponible(err("NotAllowedError"))).toBe("REFUSEE");
    expect(causeCameraIndisponible(err("SecurityError"))).toBe("REFUSEE");
    expect(causeCameraIndisponible(err("NotReadableError"))).toBe("OCCUPEE");
    expect(causeCameraIndisponible(err("NotFoundError"))).toBe("ABSENTE");
    expect(causeCameraIndisponible(err("OverconstrainedError"))).toBe("ABSENTE");
    expect(causeCameraIndisponible("pas une erreur")).toBe("ABSENTE");
  });
  it("chaque message renvoie vers l'appareil photo du téléphone, sans proposer de pointer autrement", () => {
    for (const cause of ["REFUSEE", "OCCUPEE", "ABSENTE"] as const) {
      const m = messageCameraIndisponible(cause);
      expect(m).toMatch(/appareil photo/);
      expect(m).not.toMatch(/bouton|pointer sans/i);
    }
    expect(messageCameraIndisponible("REFUSEE")).toMatch(/autoris/i);
  });
});

describe("dimensionsLecture : l'image lue par jsQR", () => {
  it("rien tant que la vidéo n'a pas de taille", () => {
    expect(dimensionsLecture(0, 0)).toBeNull();
  });
  it("réduite à 640 px de large au plus, proportions gardées", () => {
    expect(dimensionsLecture(1920, 1080)).toEqual({ largeur: 640, hauteur: 360 });
    expect(dimensionsLecture(480, 640)).toEqual({ largeur: 480, hauteur: 640 });
  });
});

describe("ecranDepuisResultat : un écran par état", () => {
  it("ARRIVEE au restaurant : « Arrivée pointée à 8 h 02. », sans avertissement", () => {
    const e = ecranDepuisResultat({ etat: "ARRIVEE", heure: ARRIVEE_8H02, verdict: AU_RESTO });
    expect(e).toEqual({ type: "ARRIVEE", titre: "Arrivée pointée à 8 h 02.", avertissement: null, motif: null });
  });

  it("ARRIVEE loin : enregistrée QUAND MÊME, avec le message hors restaurant exact et le motif", () => {
    const e = ecranDepuisResultat({ etat: "ARRIVEE", heure: ARRIVEE_8H02, verdict: LOIN });
    expect(e).toMatchObject({ type: "ARRIVEE", titre: "Arrivée pointée à 8 h 02.", avertissement: MESSAGE_HORS_RESTAURANT, motif: "à 2,3 km" });
  });

  it("position refusée → même message, motif lisible", () => {
    const e = ecranDepuisResultat({
      etat: "ARRIVEE", heure: ARRIVEE_8H02, verdict: { verdict: "A_VERIFIER", motif: "POSITION_REFUSEE", distanceM: null },
    });
    expect(e).toMatchObject({ avertissement: MESSAGE_HORS_RESTAURANT, motif: "position refusée" });
  });

  it("DEPART_TROP_TOT : la question de la conception, mot pour mot", () => {
    expect(ecranDepuisResultat({ etat: "DEPART_TROP_TOT", arriveeA: ARRIVEE_8H02 })).toEqual({
      type: "DEPART_TROP_TOT",
      titre: "Vous avez pointé votre arrivée à 8 h 02. Pointer votre départ maintenant ?",
      heureArrivee: "8 h 02",
    });
  });

  it("DEPART_TROP_TOT refusé (« Non ») : rien n'est écrit, l'arrivée reste — la caméra ne se rouvre pas", () => {
    const question = ecranDepuisResultat({ etat: "DEPART_TROP_TOT", arriveeA: ARRIVEE_8H02 });
    const e = ecranDepartRenonce(question as Extract<Ecran, { type: "DEPART_TROP_TOT" }>);
    expect(e).toEqual({ type: "INFO", titre: "Rien n'a été enregistré : votre arrivée de 8 h 02 reste pointée." });
    expect(cameraDoitTourner({ phase: "ECRAN", ecran: e }, true)).toBe(false);
  });

  it("DEPART_A_CONFIRMER : l'heure du SCAN, l'arrivée, la pause à saisir", () => {
    const e = ecranDepuisResultat({ etat: "DEPART_A_CONFIRMER", scanId: "s1", heure: DEPART_17H05, arriveeA: ARRIVEE_8H02, verdict: AU_RESTO });
    expect(e).toEqual({
      type: "DEPART_A_CONFIRMER",
      scanId: "s1",
      titre: "Départ scanné à 17 h 05.",
      detail: "Arrivée à 8 h 02. Indiquez votre pause pour clore la journée.",
      avertissement: null,
      motif: null,
      erreur: null,
    });
  });

  it("DEPART_A_CONFIRMER loin : le message hors restaurant", () => {
    const e = ecranDepuisResultat({ etat: "DEPART_A_CONFIRMER", scanId: "s1", heure: DEPART_17H05, arriveeA: ARRIVEE_8H02, verdict: LOIN });
    expect(e).toMatchObject({ avertissement: MESSAGE_HORS_RESTAURANT, motif: "à 2,3 km" });
  });

  it("COMPLETE : « Votre journée est déjà complète. »", () => {
    expect(ecranDepuisResultat({ etat: "COMPLETE" })).toEqual({ type: "COMPLETE", titre: MESSAGE_JOURNEE_COMPLETE });
  });

  it("un refus du serveur s'affiche tel quel (affiche périmée, paie validée, congé…)", () => {
    const m = "Cette affiche n'est plus valable, demandez la nouvelle à la Direction.";
    expect(ecranDepuisResultat({ erreur: m })).toEqual({ type: "ERREUR", titre: m });
  });

  it("chaque état du serveur a son écran (aucun oublié)", () => {
    const tous: ResultatScan[] = [
      { etat: "ARRIVEE", heure: ARRIVEE_8H02, verdict: AU_RESTO },
      { etat: "DEPART_A_CONFIRMER", scanId: "s", heure: DEPART_17H05, arriveeA: ARRIVEE_8H02, verdict: AU_RESTO },
      { etat: "DEPART_TROP_TOT", arriveeA: ARRIVEE_8H02 },
      { etat: "COMPLETE" },
    ];
    expect(tous.map((r) => ecranDepuisResultat(r).type)).toEqual(["ARRIVEE", "DEPART_A_CONFIRMER", "DEPART_TROP_TOT", "COMPLETE"]);
  });

  it("une connexion perdue ne se fait pas passer pour un refus ni pour un succès", () => {
    expect(MESSAGE_CONNEXION_PERDUE).toMatch(/connexion/i);
    expect(MESSAGE_CONNEXION_PERDUE).toMatch(/scannez de nouveau/i);
  });
});

describe("ecranApresConfirmation : la pause validée", () => {
  const attente = ecranDepuisResultat({
    etat: "DEPART_A_CONFIRMER", scanId: "s1", heure: DEPART_17H05, arriveeA: ARRIVEE_8H02, verdict: LOIN,
  }) as Extract<Ecran, { type: "DEPART_A_CONFIRMER" }>;

  it("départ pointé à l'heure du scan, heures nettes, avertissement conservé", () => {
    expect(ecranApresConfirmation({ heureFin: DEPART_17H05, heures: 8.55, presencesEcrites: true }, attente)).toEqual({
      type: "DEPART_CONFIRME",
      titre: "Départ pointé à 17 h 05.",
      detail: "8,55 h de travail, pause déduite. Journée enregistrée dans vos présences et vos heures.",
      heuresComptees: true,
      avertissement: MESSAGE_HORS_RESTAURANT,
      motif: "à 2,3 km",
    });
  });

  it("congé approuvé entre l'arrivée et le départ : l'écran ne prétend PAS que la journée est enregistrée", () => {
    const e = ecranApresConfirmation({ heureFin: DEPART_17H05, heures: 8.55, presencesEcrites: false }, attente);
    expect(e).toEqual({
      type: "DEPART_CONFIRME",
      titre: "Départ pointé à 17 h 05.",
      detail: "Un congé est approuvé pour ce jour : vos heures n'ont pas été comptées dans vos présences.",
      heuresComptees: false,
      avertissement: MESSAGE_HORS_RESTAURANT,
      motif: "à 2,3 km",
    });
    expect(e).toMatchObject({ detail: MESSAGE_DEPART_JOUR_DE_CONGE });
    expect((e as { detail: string }).detail).not.toMatch(/enregistrée dans vos présences/);
  });

  it("un refus garde l'écran de la pause, avec le message, pour réessayer", () => {
    expect(ecranApresConfirmation({ erreur: "Votre départ est déjà confirmé." }, attente)).toEqual({
      ...attente,
      erreur: "Votre départ est déjà confirmé.",
    });
  });
});

describe("pauseLue : la pause saisie", () => {
  it("lit des minutes entières, bornées 0-600", () => {
    expect(pauseLue("30")).toBe(30);
    expect(pauseLue("0")).toBe(0);
    expect(pauseLue(" 45 ")).toBe(45);
    expect(pauseLue("12.6")).toBe(13);
    expect(pauseLue("900")).toBe(600);
    expect(pauseLue("-5")).toBe(0);
  });
  it("vide ou illisible → rien (le bouton reste inactif)", () => {
    expect(pauseLue("")).toBeNull();
    expect(pauseLue("abc")).toBeNull();
  });
});

import { describe, it, expect, vi } from "vitest";
import type { ResultatScan } from "@/lib/pointage-scan";
import type { VerdictPosition } from "@/lib/pointage-qr";
import {
  A_VERIFIER_HORS_RESTAURANT,
  A_VERIFIER_NON_TRANSMISE,
  CONTRAINTES_CAMERA,
  DELAI_MAX_POSITION_MS,
  FRAICHEUR_POSITION_MS,
  INTERVALLE_LECTURE_MS,
  LIBELLE_ANNULER,
  MENTION_HEURE_SERVEUR,
  MESSAGE_CONNEXION_PERDUE,
  MESSAGE_DEPART_JOUR_DE_CONGE,
  MESSAGE_JOURNEE_COMPLETE,
  MESSAGE_QR_ETRANGER,
  OPTIONS_GEOLOCALISATION,
  PAUSE_DEFAUT_MIN,
  arreterPistes,
  cameraDoitTourner,
  causeCameraIndisponible,
  dimensionsLecture,
  ecranApresAnnulation,
  ecranApresPause,
  ecranDepuisResultat,
  lectureQr,
  messageCameraIndisponible,
  pauseLue,
  phaseInitiale,
  positionAReprendre,
  positionDepuisCoordonnees,
  positionDepuisErreur,
  type Ecran,
  type Phase,
} from "./scanner-affiche.logic";

// ─────────────────────────────────────────────────────────────────────────────
// La caméra, jsQR et la géolocalisation ne tournent jamais ici (`environment: "node"`). Toutes les
// DÉCISIONS du scanner vivent donc dans `scanner-affiche.logic.ts`, exercé ci-dessous ; le
// composant ne fait que brancher les appareils (son envoi sans geste est rendu, avec une action
// simulée, dans `scanner-affiche.rendu.test.tsx`).
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
    // Décision de la Direction du 2026-09-29 : « à vérifier : position hors du restaurant / non transmise ».
    expect(A_VERIFIER_HORS_RESTAURANT).toBe("À vérifier : position hors du restaurant");
    expect(A_VERIFIER_NON_TRANSMISE).toBe("À vérifier : position non transmise");
    expect(LIBELLE_ANNULER).toBe("Annuler ce pointage");
    expect(MENTION_HEURE_SERVEUR).toMatch(/serveur/);
  });

  it("les réglages des appareils sont ceux de la conception", () => {
    expect(CONTRAINTES_CAMERA).toEqual({ video: { facingMode: "environment" }, audio: false });
    expect(OPTIONS_GEOLOCALISATION).toEqual({ enableHighAccuracy: true, timeout: 8_000, maximumAge: 0 });
    expect(1000 / INTERVALLE_LECTURE_MS).toBe(5); // ~5 lectures par seconde
    expect(PAUSE_DEFAUT_MIN).toBe(30); // la pause par défaut de la Direction (2026-09-29)
    // 8 s au plus (décision du 2026-09-29) : au-delà, le pointage part sans position, « à vérifier ».
    expect(DELAI_MAX_POSITION_MS).toBe(8_000);
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
    expect(cameraDoitTourner({ phase: "ECRAN", ecran: { type: "COMPLETE", titre: MESSAGE_JOURNEE_COMPLETE, detail: "" } }, true)).toBe(false);
    expect(cameraDoitTourner({ phase: "CAMERA_INDISPONIBLE", message: "x" }, true)).toBe(false);
  });
  it("le QR étranger laisse la caméra tourner (on continue de viser)", () =>
    expect(cameraDoitTourner({ phase: "VISEE", avis: MESSAGE_QR_ETRANGER }, true)).toBe(true));
});

describe("phaseInitiale : /scan?c=… pointe sans geste (décision du 2026-09-29)", () => {
  it("sans code → la caméra", () => {
    expect(phaseInitiale()).toEqual({ phase: "VISEE", avis: null });
    expect(phaseInitiale("")).toEqual({ phase: "VISEE", avis: null });
  });
  it("avec le code de l'affiche → l'ENVOI directement, sans écran d'attente ni bouton", () => {
    expect(phaseInitiale("Abc")).toEqual({ phase: "ENVOI" });
  });
  it("pendant l'envoi, la caméra ne tourne pas", () =>
    expect(cameraDoitTourner(phaseInitiale("Abc"), true)).toBe(false));
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

// La pause par défaut : affichée « 30 min (non déduite) », 0 min retirée (décision d'argent du 2026-09-29).
const pauseDefaut = { parDefaut: true, minutesDeduites: 0 };

describe("ecranDepuisResultat : un écran par état", () => {
  const arrivee = (verdict: VerdictPosition, repete = false): ResultatScan => ({
    etat: "ARRIVEE", scanId: "a1", heure: ARRIVEE_8H02, verdict, repete, annulableMs: 300_000,
  });
  const depart = (o: { repete?: boolean; verdict?: VerdictPosition; presencesEcrites?: boolean } = {}): ResultatScan => ({
    etat: "DEPART", scanId: "s1", heure: DEPART_17H05, arriveeA: ARRIVEE_8H02, verdict: o.verdict ?? AU_RESTO,
    repete: o.repete ?? false, annulableMs: 300_000, pause: pauseDefaut, heures: 8.55,
    presencesEcrites: o.presencesEcrites ?? true, pauseModifiable: true,
  });

  it("ARRIVEE au restaurant : « Arrivée enregistrée à 8 h 02 », sans avertissement, annulable", () => {
    expect(ecranDepuisResultat(arrivee(AU_RESTO))).toEqual({
      type: "ARRIVEE",
      scanId: "a1",
      titre: "Arrivée enregistrée à 8 h 02",
      detail: null,
      avertissement: null,
      motif: null,
      annulableMs: 300_000,
      erreur: null,
    });
  });

  it("ARRIVEE loin : enregistrée QUAND MÊME, « à vérifier : position hors du restaurant » et le motif", () => {
    expect(ecranDepuisResultat(arrivee(LOIN))).toMatchObject({
      titre: "Arrivée enregistrée à 8 h 02", avertissement: A_VERIFIER_HORS_RESTAURANT, motif: "à 2,3 km",
    });
  });

  it("précision insuffisante : hors du restaurant (la position n'a pas permis de conclure)", () => {
    expect(
      ecranDepuisResultat(arrivee({ verdict: "A_VERIFIER", motif: "PRECISION_INSUFFISANTE", distanceM: 40, precisionM: 900 })),
    ).toMatchObject({ avertissement: A_VERIFIER_HORS_RESTAURANT, motif: "précision ±900 m" });
  });

  it("position refusée ou indisponible (8 s dépassées) : « à vérifier : position non transmise »", () => {
    expect(ecranDepuisResultat(arrivee({ verdict: "A_VERIFIER", motif: "POSITION_REFUSEE", distanceM: null }))).toMatchObject({
      avertissement: A_VERIFIER_NON_TRANSMISE, motif: "position refusée",
    });
    expect(ecranDepuisResultat(arrivee({ verdict: "A_VERIFIER", motif: "POSITION_INDISPONIBLE", distanceM: null }))).toMatchObject({
      avertissement: A_VERIFIER_NON_TRANSMISE, motif: "position indisponible",
    });
  });

  it("scan répété : « déjà enregistrée », et l'écran dit que ce scan n'a rien changé", () => {
    expect(ecranDepuisResultat(arrivee(AU_RESTO, true))).toMatchObject({
      titre: "Arrivée déjà enregistrée à 8 h 02", detail: "Ce nouveau scan n'a rien changé.",
    });
    expect(ecranDepuisResultat(depart({ repete: true }))).toMatchObject({
      titre: "Départ déjà enregistré à 17 h 05",
      detail: expect.stringMatching(/Ce nouveau scan n'a rien changé\.$/),
    });
  });

  it("DEPART : enregistré à l'heure du SCAN, journée close, pause PAR DÉFAUT nommée comme telle, annulable", () => {
    expect(ecranDepuisResultat(depart())).toEqual({
      type: "DEPART",
      scanId: "s1",
      titre: "Départ enregistré à 17 h 05",
      detail: "Arrivée à 8 h 02. 8,55 h de travail, pause par défaut 30 min (non déduite). Journée enregistrée dans vos présences et vos heures.",
      heuresComptees: true,
      avertissement: null,
      motif: null,
      annulableMs: 300_000,
      pauseModifiable: true,
      erreur: null,
    });
  });

  it("DEPART un jour de congé approuvé : l'écran ne prétend PAS que la journée est enregistrée", () => {
    const e = ecranDepuisResultat(depart({ presencesEcrites: false }));
    expect(e).toMatchObject({ heuresComptees: false, detail: `Arrivée à 8 h 02. ${MESSAGE_DEPART_JOUR_DE_CONGE}` });
  });

  it("COMPLETE : la journée, ses deux heures et sa pause", () => {
    expect(
      ecranDepuisResultat({ etat: "COMPLETE", arriveeA: ARRIVEE_8H02, departA: DEPART_17H05, pause: { parDefaut: false, minutesDeduites: 45 } }),
    ).toEqual({
      type: "COMPLETE", titre: MESSAGE_JOURNEE_COMPLETE, detail: "Arrivée à 8 h 02, départ à 17 h 05, pause 45 min.",
    });
  });

  it("COMPLETE avec la pause par défaut : dite « non déduite »", () => {
    expect(ecranDepuisResultat({ etat: "COMPLETE", arriveeA: ARRIVEE_8H02, departA: DEPART_17H05, pause: pauseDefaut })).toMatchObject({
      detail: "Arrivée à 8 h 02, départ à 17 h 05, pause par défaut 30 min (non déduite).",
    });
  });

  it("un refus du serveur s'affiche tel quel (affiche périmée, paie validée, congé…)", () => {
    const m = "Cette affiche n'est plus valable, demandez la nouvelle à la Direction.";
    expect(ecranDepuisResultat({ erreur: m })).toEqual({ type: "ERREUR", titre: m });
  });

  it("chaque état du serveur a son écran (aucun oublié)", () => {
    const tous: ResultatScan[] = [
      arrivee(AU_RESTO),
      depart(),
      { etat: "COMPLETE", arriveeA: ARRIVEE_8H02, departA: DEPART_17H05, pause: pauseDefaut },
    ];
    expect(tous.map((r) => ecranDepuisResultat(r).type)).toEqual(["ARRIVEE", "DEPART", "COMPLETE"]);
  });

  it("une connexion perdue ne se fait pas passer pour un refus ni pour un succès", () => {
    expect(MESSAGE_CONNEXION_PERDUE).toMatch(/connexion/i);
    expect(MESSAGE_CONNEXION_PERDUE).toMatch(/scannez de nouveau/i);
  });
});

describe("ecranApresAnnulation : « Annuler ce pointage »", () => {
  const origine = ecranDepuisResultat({
    etat: "ARRIVEE", scanId: "a1", heure: ARRIVEE_8H02, verdict: AU_RESTO, repete: false, annulableMs: 300_000,
  }) as Extract<Ecran, { type: "ARRIVEE" }>;

  it("arrivée ou départ annulé : ce qui n'est plus retenu, et comment reprendre", () => {
    expect(ecranApresAnnulation({ moment: "ARRIVEE", heure: ARRIVEE_8H02 }, origine)).toEqual({
      type: "INFO",
      titre: "Pointage annulé. Votre arrivée de 8 h 02 n'est plus retenue : scannez de nouveau l'affiche pour pointer.",
    });
    expect(ecranApresAnnulation({ moment: "DEPART", heure: DEPART_17H05 }, origine)).toMatchObject({
      titre:
        "Pointage annulé. Votre départ de 17 h 05 n'est plus retenu, votre journée est rouverte : scannez de nouveau l'affiche pour pointer.",
    });
  });

  it("refus (délai passé…) : l'écran d'origine, le refus, et plus de bouton d'annulation", () => {
    expect(ecranApresAnnulation({ erreur: "Le délai d'annulation (5 minutes) est passé." }, origine)).toEqual({
      ...origine,
      annulableMs: 0,
      erreur: "Le délai d'annulation (5 minutes) est passé.",
    });
  });
});

describe("ecranApresPause : la pause, facultative, saisie après le départ", () => {
  const depart = ecranDepuisResultat({
    etat: "DEPART", scanId: "s1", heure: DEPART_17H05, arriveeA: ARRIVEE_8H02, verdict: LOIN, repete: false,
    annulableMs: 0, pause: pauseDefaut, heures: 8.55, presencesEcrites: true, pauseModifiable: true,
  }) as Extract<Ecran, { type: "DEPART" }>;

  it("départ à l'heure du scan, la pause SAISIE et les heures nettes, avertissement conservé", () => {
    expect(ecranApresPause({ heureFin: DEPART_17H05, heures: 8.3, presencesEcrites: true, pauseMinutes: 45 }, depart)).toEqual({
      type: "PAUSE_ENREGISTREE",
      titre: "Départ enregistré à 17 h 05",
      detail: "Pause de 45 min enregistrée et déduite : 8,3 h de travail. Journée enregistrée dans vos présences et vos heures.",
      heuresComptees: true,
      avertissement: A_VERIFIER_HORS_RESTAURANT,
      motif: "à 2,3 km",
    });
  });

  it("congé approuvé ce jour : l'écran ne prétend PAS que la journée est enregistrée", () => {
    const e = ecranApresPause({ heureFin: DEPART_17H05, heures: 8.3, presencesEcrites: false, pauseMinutes: 45 }, depart);
    expect(e).toMatchObject({ type: "PAUSE_ENREGISTREE", heuresComptees: false, detail: MESSAGE_DEPART_JOUR_DE_CONGE });
  });

  it("un refus garde l'écran du départ, avec le message, pour réessayer", () => {
    expect(ecranApresPause({ erreur: "Votre pause est déjà enregistrée." }, depart)).toEqual({
      ...depart,
      erreur: "Votre pause est déjà enregistrée.",
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

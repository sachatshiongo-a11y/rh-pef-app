"use client";

// Le scanner de l'affiche de pointage : la caméra s'ouvre DANS l'application (sur iPhone, scanner
// avec l'appareil photo ouvre Safari, dont la session est distincte de celle de l'application
// installée), jsQR lit l'affiche, le téléphone donne sa position, le serveur tranche.
//
// Branchements d'appareils seulement : toutes les décisions vivent dans `scanner-affiche.logic.ts`
// (testé). Deux règles tenues ici :
//   • jsQR tourne SUR LE FIL PRINCIPAL, sans worker : aucun fichier supplémentaire servi derrière
//     le garde d'authentification (piège rencontré quatre fois dans cette famille de dépôts) ;
//   • la caméra est libérée (toutes les pistes arrêtées) dès qu'un code d'affiche est lu, au
//     démontage, et quand la page passe en arrière-plan — cf. `cameraDoitTourner`.
// Aucun bouton ne pointe sans scan : sans caméra, le recours est l'appareil photo du téléphone.
// Scanner = pointer (décision de la Direction du 2026-09-29) : un code lu par la caméra, ou reçu
// par l'adresse (`/scan?c=…`), part tout seul — depuis CE script, après le chargement de la page,
// jamais depuis la requête GET (un aperçu de lien ou un préchargement ne pointe rien). Garde-fous
// à la place du bouton : scan répété sous 10 min = rien de nouveau (serveur) ; « Annuler ce
// pointage » pendant 5 min ; la pause, facultative, se saisit après (sinon : 30 min par défaut).

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import jsQR from "jsqr";
import { BoutonNeutre, BoutonValider } from "@/components/action-buttons";
import { ChampNombre } from "@/components/champ-nombre";
import { versSaisie } from "@/lib/nombre";
import { annulerPointage, saisirMaPause, scannerAffiche } from "@/app/pointage/actions";
import type { PositionScan } from "@/lib/pointage-qr";
import { originesAcceptees } from "@/lib/pointage-origines";
import {
  CONTRAINTES_CAMERA,
  DELAI_MAX_POSITION_MS,
  INTERVALLE_LECTURE_MS,
  LIBELLE_ANNULER,
  MENTION_HEURE_SERVEUR,
  MESSAGE_CONNEXION_PERDUE,
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
  SUITE_A_VERIFIER,
  type Ecran,
  type Phase,
} from "./scanner-affiche.logic";

/** Demande la position une fois ; ne rejette jamais (une erreur devient REFUSEE / INDISPONIBLE). */
function demanderPosition(): Promise<PositionScan> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve(positionDepuisErreur(undefined));
      return;
    }
    let fini = false;
    const conclure = (p: PositionScan) => {
      if (fini) return;
      fini = true;
      clearTimeout(plafond);
      resolve(p);
    };
    const plafond = setTimeout(() => conclure(positionDepuisErreur(undefined)), DELAI_MAX_POSITION_MS);
    navigator.geolocation.getCurrentPosition(
      (pos) => conclure(positionDepuisCoordonnees(pos.coords)),
      (err) => conclure(positionDepuisErreur(err?.code)),
      OPTIONS_GEOLOCALISATION,
    );
  });
}

/** Vrai tant que la page est au premier plan (changement d'application, écran verrouillé → faux). */
function abonnerVisibilite(prevenir: () => void): () => void {
  document.addEventListener("visibilitychange", prevenir);
  window.addEventListener("pagehide", prevenir);
  window.addEventListener("pageshow", prevenir);
  return () => {
    document.removeEventListener("visibilitychange", prevenir);
    window.removeEventListener("pagehide", prevenir);
    window.removeEventListener("pageshow", prevenir);
  };
}
function usePageVisible(): boolean {
  return useSyncExternalStore(
    abonnerVisibilite,
    () => document.visibilityState === "visible",
    () => true,
  );
}

const CLASSES_BOUTON_PLEIN = "min-h-11 w-full justify-center";

export function ScannerAffiche({ codeInitial }: { codeInitial?: string }) {
  const router = useRouter();
  const [etat, setEtat] = useState<Phase>(() => phaseInitiale(codeInitial));
  const [pause, setPause] = useState(versSaisie(PAUSE_DEFAUT_MIN));
  const [enCours, demarrer] = useTransition();
  const visible = usePageVisible();

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const position = useRef<{ promesse: Promise<PositionScan>; demandeeA: number } | null>(null);

  const positionFraiche = useCallback((): Promise<PositionScan> => {
    const maintenant = Date.now();
    if (!position.current || positionAReprendre(position.current.demandeeA, maintenant)) {
      position.current = { promesse: demanderPosition(), demandeeA: maintenant };
    }
    return position.current.promesse;
  }, []);

  const envoyerCode = useCallback(
    async (code: string) => {
      let ecran: Ecran;
      try {
        // Sans position au bout de 8 s (ou refusée), le pointage part quand même : « à vérifier ».
        ecran = ecranDepuisResultat(await scannerAffiche({ code, position: await positionFraiche() }));
      } catch {
        ecran = { type: "ERREUR", titre: MESSAGE_CONNEXION_PERDUE };
      }
      setEtat({ phase: "ECRAN", ecran });
      if (ecran.type === "ARRIVEE" || ecran.type === "DEPART" || ecran.type === "COMPLETE") router.refresh();
    },
    [router, positionFraiche],
  );

  const codeLu = useCallback(
    (code: string) => {
      setEtat({ phase: "ENVOI" });
      void envoyerCode(code);
    },
    [envoyerCode],
  );

  // Au chargement : la position est demandée tout de suite (en parallèle de la visée, ou de l'envoi
  // du code reçu par l'adresse). Chemin /scan?c=… : le pointage part ICI, une seule fois (le
  // double montage du mode strict ne l'envoie pas deux fois) — et le code est retiré de l'adresse,
  // pour qu'un rechargement de l'onglet (Safari restaure les onglets des heures plus tard) ne
  // rejoue pas l'affiche lue. Un rescan malgré tout ne ferait rien de nouveau sous 10 min.
  const initialise = useRef(false);
  useEffect(() => {
    if (initialise.current) return;
    initialise.current = true;
    if (codeInitial) {
      window.history.replaceState(window.history.state, "", window.location.pathname);
      void envoyerCode(codeInitial);
    } else {
      void positionFraiche();
    }
  }, [codeInitial, envoyerCode, positionFraiche]);

  // La boucle de lecture appelle toujours la DERNIÈRE version de `codeLu` sans relancer la caméra.
  const codeLuRef = useRef(codeLu);
  useEffect(() => {
    codeLuRef.current = codeLu;
  }, [codeLu]);

  // La caméra : ouverte quand `cameraDoitTourner` devient vrai, TOUTES les pistes arrêtées quand il
  // devient faux (code lu, page en arrière-plan) et au démontage.
  const camera = cameraDoitTourner(etat, visible);
  useEffect(() => {
    if (!camera) return;
    let flux: MediaStream | null = null;
    let arrete = false;
    let minuteur: ReturnType<typeof setTimeout> | undefined;
    const video = videoRef.current;

    const lire = () => {
      if (arrete) return;
      const canvas = canvasRef.current;
      const taille = video && video.readyState >= 2 ? dimensionsLecture(video.videoWidth, video.videoHeight) : null;
      const ctx = canvas?.getContext("2d", { willReadFrequently: true });
      if (video && canvas && ctx && taille) {
        canvas.width = taille.largeur;
        canvas.height = taille.hauteur;
        ctx.drawImage(video, 0, 0, taille.largeur, taille.hauteur);
        const image = ctx.getImageData(0, 0, taille.largeur, taille.hauteur);
        const qr = jsQR(image.data, taille.largeur, taille.hauteur, { inversionAttempts: "dontInvert" });
        if (qr) {
          const lecture = lectureQr(qr.data, originesAcceptees(window.location.origin));
          if ("code" in lecture) {
            arrete = true;
            arreterPistes(flux); // tout de suite, sans attendre le rendu suivant
            codeLuRef.current(lecture.code);
            return;
          }
          setEtat((e) => (e.phase === "VISEE" && e.avis !== lecture.avis ? { phase: "VISEE", avis: lecture.avis } : e));
        }
      }
      minuteur = setTimeout(lire, INTERVALLE_LECTURE_MS);
    };

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setEtat({ phase: "CAMERA_INDISPONIBLE", message: messageCameraIndisponible("ABSENTE") });
        return;
      }
      try {
        flux = await navigator.mediaDevices.getUserMedia(CONTRAINTES_CAMERA);
      } catch (e) {
        if (!arrete) setEtat({ phase: "CAMERA_INDISPONIBLE", message: messageCameraIndisponible(causeCameraIndisponible(e)) });
        return;
      }
      // Démonté (ou passé en arrière-plan) pendant l'invite de permission : on rend la caméra.
      if (arrete || !video) {
        arreterPistes(flux);
        return;
      }
      video.srcObject = flux;
      await video.play().catch(() => {}); // muet + playsInline : iOS le permet sans geste
      lire();
    })();

    return () => {
      arrete = true;
      clearTimeout(minuteur);
      arreterPistes(flux);
      if (video) video.srcObject = null;
    };
  }, [camera]);

  // « Annuler ce pointage » disparaît à l'échéance donnée par le serveur (compte à rebours depuis
  // SA réponse : l'horloge du téléphone n'y entre pas). Le serveur refuse de toute façon au-delà.
  const annulable =
    etat.phase === "ECRAN" && (etat.ecran.type === "ARRIVEE" || etat.ecran.type === "DEPART") && etat.ecran.annulableMs > 0
      ? etat.ecran
      : null;
  const annulableId = annulable?.scanId;
  const annulableDelai = annulable?.annulableMs;
  useEffect(() => {
    if (!annulableId || !annulableDelai) return;
    const minuteur = setTimeout(() => {
      setEtat((e) =>
        e.phase === "ECRAN" && (e.ecran.type === "ARRIVEE" || e.ecran.type === "DEPART") && e.ecran.scanId === annulableId
          ? { phase: "ECRAN", ecran: { ...e.ecran, annulableMs: 0 } }
          : e,
      );
    }, annulableDelai);
    return () => clearTimeout(minuteur);
  }, [annulableId, annulableDelai]);

  const reviser = () => {
    setPause(versSaisie(PAUSE_DEFAUT_MIN));
    setEtat({ phase: "VISEE", avis: null });
  };

  const annuler = (origine: Extract<Ecran, { type: "ARRIVEE" | "DEPART" }>) => {
    demarrer(async () => {
      let suite: Ecran;
      try {
        suite = ecranApresAnnulation(await annulerPointage({ scanId: origine.scanId }), origine);
      } catch {
        suite = { ...origine, erreur: MESSAGE_CONNEXION_PERDUE };
      }
      setEtat({ phase: "ECRAN", ecran: suite });
      router.refresh();
    });
  };

  const validerPause = (depart: Extract<Ecran, { type: "DEPART" }>) => {
    const minutes = pauseLue(pause);
    if (minutes === null) return;
    demarrer(async () => {
      let suite: Ecran;
      try {
        suite = ecranApresPause(await saisirMaPause({ scanId: depart.scanId, pauseMinutes: minutes }), depart);
      } catch {
        suite = { ...depart, erreur: MESSAGE_CONNEXION_PERDUE };
      }
      setEtat({ phase: "ECRAN", ecran: suite });
      if (suite.type === "PAUSE_ENREGISTREE") router.refresh();
    });
  };

  // ── Rendu ──────────────────────────────────────────────────────────────────
  if (etat.phase === "VISEE") {
    return (
      <div className="space-y-3">
        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-2xl border bg-black">
          <video ref={videoRef} playsInline muted autoPlay aria-label="Caméra" className="h-full w-full object-cover" />
          <div aria-hidden="true" className="pointer-events-none absolute inset-[18%] rounded-xl border-2 border-white/80" />
          <canvas ref={canvasRef} className="hidden" />
        </div>
        <p className="text-center text-sm text-muted-foreground">Visez le QR code de l&apos;affiche de pointage.</p>
        {etat.avis && <Avis ton="erreur">{etat.avis}</Avis>}
        {!visible && <p className="text-center text-xs text-muted-foreground">Caméra en pause.</p>}
      </div>
    );
  }

  if (etat.phase === "CAMERA_INDISPONIBLE") {
    return (
      <div className="space-y-3">
        <Avis ton="attention">{etat.message}</Avis>
        <BoutonNeutre type="button" onClick={reviser} className={CLASSES_BOUTON_PLEIN}>
          Réessayer la caméra
        </BoutonNeutre>
      </div>
    );
  }

  if (etat.phase === "ENVOI") {
    return (
      <div role="status" className="flex flex-col items-center gap-2 rounded-2xl border bg-background px-4 py-8 text-center">
        <span aria-hidden="true" className="size-6 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-primary" />
        <p className="text-sm font-medium">Pointage en cours…</p>
        <p className="text-xs text-muted-foreground">Le téléphone relève sa position, cela peut prendre quelques secondes.</p>
      </div>
    );
  }

  const ecran = etat.ecran;
  switch (ecran.type) {
    case "ARRIVEE":
      return (
        <div className="space-y-3">
          <Resultat titre={ecran.titre} detail={ecran.detail} />
          <AvertissementPosition avertissement={ecran.avertissement} motif={ecran.motif} />
          {ecran.erreur && <Avis ton="erreur">{ecran.erreur}</Avis>}
          {ecran.annulableMs > 0 && <BoutonAnnuler onClick={() => annuler(ecran)} enCours={enCours} />}
        </div>
      );

    case "DEPART": {
      // La journée est CLOSE (départ horodaté au scan, pause par défaut 30 min, NON déduite, si rien
      // n'est saisi) ; la pause du salarié vient après, facultative, remplace alors la pause par
      // défaut et SE DÉDUIT (décision d'argent de la Direction du 2026-09-29).
      const minutes = pauseLue(pause);
      return (
        <div className="space-y-3">
          {ecran.heuresComptees ? (
            <Resultat titre={ecran.titre} detail={ecran.detail} />
          ) : (
            <>
              <Resultat titre={ecran.titre} detail={null} />
              <Avis ton="attention">{ecran.detail}</Avis>
            </>
          )}
          <AvertissementPosition avertissement={ecran.avertissement} motif={ecran.motif} />
          {ecran.pauseModifiable && (
            <div className="space-y-2 rounded-xl border bg-background px-4 py-3">
              <label className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium">
                  Ma pause du jour <span className="font-normal text-muted-foreground">(facultatif)</span>
                </span>
                <span className="flex items-center gap-2">
                  <ChampNombre
                    value={pause}
                    onChange={(e) => setPause(e.target.value)}
                    suffixe="min"
                    classeConteneur="w-20 items-end"
                    className="w-full rounded-md border border-input bg-background px-2 py-1 text-right text-base tabular-nums"
                  />
                  <span className="text-muted-foreground">min</span>
                </span>
              </label>
              <p className="text-xs text-muted-foreground">
                Sans saisie, la pause par défaut de {PAUSE_DEFAUT_MIN} min s&apos;affiche mais n&apos;est pas déduite de
                vos heures. Une pause enregistrée ici est déduite.
              </p>
              <BoutonValider
                type="button"
                onClick={() => validerPause(ecran)}
                disabled={enCours || minutes === null}
                className={CLASSES_BOUTON_PLEIN}
              >
                {enCours ? "Enregistrement…" : "Enregistrer ma pause"}
              </BoutonValider>
            </div>
          )}
          {ecran.erreur && <Avis ton="erreur">{ecran.erreur}</Avis>}
          {ecran.annulableMs > 0 && <BoutonAnnuler onClick={() => annuler(ecran)} enCours={enCours} />}
        </div>
      );
    }

    case "PAUSE_ENREGISTREE":
      // Congé approuvé ce jour : le départ est clos mais les heures ne sont pas comptées — encadré
      // d'attention, jamais le vert d'une journée enregistrée.
      return (
        <div className="space-y-3">
          <Resultat titre={ecran.titre} detail={ecran.heuresComptees ? ecran.detail : null} />
          {!ecran.heuresComptees && <Avis ton="attention">{ecran.detail}</Avis>}
          <AvertissementPosition avertissement={ecran.avertissement} motif={ecran.motif} />
        </div>
      );

    case "COMPLETE":
      return (
        <Avis ton="succes">
          <span className="block text-base font-semibold">{ecran.titre}</span>
          <span className="mt-1 block">{ecran.detail}</span>
        </Avis>
      );

    case "INFO":
      return (
        <div className="space-y-3">
          <Avis ton="neutre">{ecran.titre}</Avis>
          <BoutonNeutre type="button" onClick={reviser} className={CLASSES_BOUTON_PLEIN}>
            Scanner de nouveau
          </BoutonNeutre>
        </div>
      );

    case "ERREUR":
      return (
        <div className="space-y-3">
          <Avis ton="erreur">{ecran.titre}</Avis>
          <BoutonNeutre type="button" onClick={reviser} className={CLASSES_BOUTON_PLEIN}>
            Scanner de nouveau
          </BoutonNeutre>
        </div>
      );
  }
}

/** Le résultat EN GRAND (« Arrivée enregistrée à 8 h 02 »), l'heure étant celle du serveur. */
function Resultat({ titre, detail }: { titre: string; detail: string | null }) {
  return (
    <Avis ton="succes">
      <span className="block text-2xl font-bold leading-tight tabular-nums">{titre}</span>
      <span className="mt-1 block text-xs opacity-80">{MENTION_HEURE_SERVEUR}</span>
      {detail && <span className="mt-2 block">{detail}</span>}
    </Avis>
  );
}

function BoutonAnnuler({ onClick, enCours }: { onClick: () => void; enCours: boolean }) {
  return (
    <BoutonNeutre type="button" onClick={onClick} disabled={enCours} className={CLASSES_BOUTON_PLEIN}>
      {enCours ? "Un instant…" : LIBELLE_ANNULER}
    </BoutonNeutre>
  );
}

function AvertissementPosition({ avertissement, motif }: { avertissement: string | null; motif: string | null }) {
  if (!avertissement) return null;
  return (
    <Avis ton="attention">
      <span className="block font-semibold">{avertissement}</span>
      <span className="mt-1 block">{SUITE_A_VERIFIER}</span>
      {motif && <span className="mt-1 block text-xs opacity-80">Motif : {motif}.</span>}
    </Avis>
  );
}

// Mêmes encadrés que l'écran de pointage existant (pointer-client.tsx) : succès en émeraude, refus
// en destructif ; « attention » reprend l'ambre des états « en attente » de l'espace salarié.
const TONS = {
  succes:
    "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
  attention:
    "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
  erreur: "border-destructive/40 bg-destructive/10 text-destructive",
  neutre: "bg-background text-foreground",
} as const;

function Avis({ ton, children }: { ton: keyof typeof TONS; children: React.ReactNode }) {
  return (
    <div role={ton === "erreur" ? "alert" : "status"} className={`rounded-2xl border px-4 py-3 text-sm ${TONS[ton]}`}>
      {children}
    </div>
  );
}

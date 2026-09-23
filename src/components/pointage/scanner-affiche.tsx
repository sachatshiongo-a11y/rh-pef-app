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

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import jsQR from "jsqr";
import { BoutonNeutre, BoutonValider } from "@/components/action-buttons";
import { confirmerDepart, scannerAffiche } from "@/app/pointage/actions";
import type { PositionScan } from "@/lib/pointage-qr";
import {
  CONTRAINTES_CAMERA,
  DELAI_MAX_POSITION_MS,
  INTERVALLE_LECTURE_MS,
  MESSAGE_CONNEXION_PERDUE,
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
  phaseInitiale,
  positionAReprendre,
  positionDepuisCoordonnees,
  positionDepuisErreur,
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
  const [pause, setPause] = useState(String(PAUSE_DEFAUT_MIN));
  const [enCours, demarrer] = useTransition();
  const visible = usePageVisible();

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const position = useRef<{ promesse: Promise<PositionScan>; demandeeA: number } | null>(null);
  const dernierEnvoi = useRef<{ code: string; position: PositionScan } | null>(null);

  const positionFraiche = useCallback((): Promise<PositionScan> => {
    const maintenant = Date.now();
    if (!position.current || positionAReprendre(position.current.demandeeA, maintenant)) {
      position.current = { promesse: demanderPosition(), demandeeA: maintenant };
    }
    return position.current.promesse;
  }, []);

  const envoyer = useCallback(
    async (code: string, p: PositionScan, confirmerDepartRapide: boolean) => {
      dernierEnvoi.current = { code, position: p };
      let ecran: Ecran;
      try {
        ecran = ecranDepuisResultat(await scannerAffiche({ code, position: p, confirmerDepartRapide }));
      } catch {
        ecran = { type: "ERREUR", titre: MESSAGE_CONNEXION_PERDUE };
      }
      setEtat({ phase: "ECRAN", ecran });
      if (ecran.type === "ARRIVEE" || ecran.type === "COMPLETE" || ecran.type === "DEPART_A_CONFIRMER") router.refresh();
    },
    [router],
  );

  const envoyerCode = useCallback(
    async (code: string) => envoyer(code, await positionFraiche(), false),
    [envoyer, positionFraiche],
  );

  const codeLu = useCallback(
    (code: string) => {
      setEtat({ phase: "ENVOI" });
      void envoyerCode(code);
    },
    [envoyerCode],
  );

  // La position est demandée dès l'ouverture, EN PARALLÈLE de la visée : elle est prête au scan.
  // Chemin /scan?c=… : le code vient de l'appareil photo du téléphone, on l'envoie aussitôt — et
  // on le retire de l'adresse, pour qu'un rechargement de l'onglet (Safari restaure les onglets
  // des heures plus tard) ne pointe pas un départ à l'insu du salarié.
  const initialise = useRef(false);
  useEffect(() => {
    if (initialise.current) return;
    initialise.current = true;
    if (codeInitial) {
      window.history.replaceState(window.history.state, "", window.location.pathname);
      void envoyerCode(codeInitial); // la phase initiale est déjà ENVOI
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
          const lecture = lectureQr(qr.data, window.location.origin);
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

  const reviser = () => {
    setPause(String(PAUSE_DEFAUT_MIN));
    setEtat({ phase: "VISEE", avis: null });
  };

  const confirmerDepartRapide = () => {
    const d = dernierEnvoi.current;
    if (!d) return reviser();
    setEtat({ phase: "ENVOI" });
    void envoyer(d.code, d.position, true); // même code, même position
  };

  const validerPause = (attente: Extract<Ecran, { type: "DEPART_A_CONFIRMER" }>) => {
    const minutes = pauseLue(pause);
    if (minutes === null) return;
    demarrer(async () => {
      let suite: Ecran;
      try {
        suite = ecranApresConfirmation(await confirmerDepart({ scanId: attente.scanId, pauseMinutes: minutes }), attente);
      } catch {
        suite = { ...attente, erreur: MESSAGE_CONNEXION_PERDUE };
      }
      setEtat({ phase: "ECRAN", ecran: suite });
      if (suite.type === "DEPART_CONFIRME") router.refresh();
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
    case "DEPART_CONFIRME":
      return (
        <div className="space-y-3">
          <Avis ton="succes">
            <span className="block text-base font-semibold">{ecran.titre}</span>
            {ecran.type === "DEPART_CONFIRME" && <span className="mt-1 block">{ecran.detail}</span>}
          </Avis>
          <AvertissementPosition avertissement={ecran.avertissement} motif={ecran.motif} />
        </div>
      );

    case "DEPART_TROP_TOT":
      return (
        <div className="space-y-3">
          <Avis ton="attention">{ecran.titre}</Avis>
          <div className="flex flex-col gap-2">
            <BoutonValider type="button" onClick={confirmerDepartRapide} className={CLASSES_BOUTON_PLEIN}>
              Oui, pointer mon départ
            </BoutonValider>
            <BoutonNeutre
              type="button"
              onClick={() => setEtat({ phase: "ECRAN", ecran: ecranDepartRenonce(ecran) })}
              className={CLASSES_BOUTON_PLEIN}
            >
              Non, c&apos;était une erreur
            </BoutonNeutre>
          </div>
        </div>
      );

    case "DEPART_A_CONFIRMER": {
      const minutes = pauseLue(pause);
      return (
        <div className="space-y-3">
          <div className="rounded-2xl border bg-background px-4 py-3">
            <p className="text-base font-semibold">{ecran.titre}</p>
            <p className="mt-1 text-sm text-muted-foreground">{ecran.detail}</p>
          </div>
          <AvertissementPosition avertissement={ecran.avertissement} motif={ecran.motif} />
          <label className="flex items-center justify-between gap-3 rounded-xl border bg-background px-4 py-3 text-sm">
            <span className="font-medium">Ma pause du jour</span>
            <span className="flex items-center gap-2">
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={600}
                step={5}
                value={pause}
                onChange={(e) => setPause(e.target.value)}
                className="w-20 rounded-md border border-input bg-background px-2 py-1 text-right text-base tabular-nums"
              />
              <span className="text-muted-foreground">min</span>
            </span>
          </label>
          {ecran.erreur && <Avis ton="erreur">{ecran.erreur}</Avis>}
          <BoutonValider
            type="button"
            onClick={() => validerPause(ecran)}
            disabled={enCours || minutes === null}
            className={CLASSES_BOUTON_PLEIN}
          >
            {enCours ? "Enregistrement…" : "Valider mon départ"}
          </BoutonValider>
        </div>
      );
    }

    case "COMPLETE":
      return <Avis ton="succes">{ecran.titre}</Avis>;

    case "INFO":
      return <Avis ton="neutre">{ecran.titre}</Avis>;

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

function AvertissementPosition({ avertissement, motif }: { avertissement: string | null; motif: string | null }) {
  if (!avertissement) return null;
  return (
    <Avis ton="attention">
      {avertissement}
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

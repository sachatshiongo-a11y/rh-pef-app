"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BoutonNeutre, CLASSES_DANGER, CLASSES_GEOMETRIE, CLASSES_NEUTRE } from "@/components/action-buttons";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { TelechargerLien } from "@/components/telecharger-lien";
import { estErreur } from "@/lib/action-lisible";
import { formaterNombre } from "@/lib/montant";
import {
  coordonneesSaisissables,
  lireCoordonneesSaisies,
  MESSAGE_POSITION_NON_REGLEE,
  PRECISION_REGLAGE_MAX_M,
} from "@/lib/pointage-qr";
import { changerCodeAffiche, reglerPositionRestaurant, reglerRayon } from "./pointage-actions";

// Paramètres → Pointage : la position du restaurant (GPS sur place, ou coordonnées copiées depuis
// Google Maps — un ordinateur se positionne souvent par le Wi-Fi, peu cartographié à Kinshasa),
// le rayon toléré, l'affiche à imprimer et le changement de son code. Les refus viennent du
// serveur, affichés tels quels : un seul endroit décide.

const inputCls = "rounded-md border border-input bg-background px-3 py-2 text-sm";
const CLASSES_ENREGISTRER = `${CLASSES_GEOMETRIE} bg-primary text-primary-foreground hover:bg-primary/90`;

export type ReglagesPointage = {
  lat: number | null;
  lng: number | null;
  /** « précision ±12 m » ou « saisie manuelle » (dernier réglage journalisé), null si inconnu. */
  mesure: string | null;
  rayonM: number;
};

type Avis = { type: "ok" | "erreur"; texte: string } | null;

export function PointageReglages({ reglages }: { reglages: ReglagesPointage }) {
  const router = useRouter();
  const [enCours, demarrer] = useTransition();
  const [localisation, setLocalisation] = useState(false);
  const [avis, setAvis] = useState<Avis>(null);
  const [saisie, setSaisie] = useState("");
  const positionReglee = reglages.lat !== null && reglages.lng !== null;

  function executer(fn: () => Promise<unknown>, succes: string) {
    setAvis(null);
    demarrer(async () => {
      const r = await fn();
      if (estErreur(r)) {
        setAvis({ type: "erreur", texte: r.erreur });
        return;
      }
      setAvis({ type: "ok", texte: succes });
      router.refresh();
    });
  }

  function utiliserMaPosition() {
    setAvis(null);
    if (!("geolocation" in navigator)) {
      setAvis({ type: "erreur", texte: "Cet appareil ne donne pas sa position : saisissez les coordonnées à la main." });
      return;
    }
    setLocalisation(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocalisation(false);
        const precisionM = p.coords.accuracy;
        executer(
          () => reglerPositionRestaurant({ lat: p.coords.latitude, lng: p.coords.longitude, precisionM }),
          `Position du restaurant enregistrée (précision ±${formaterNombre(Math.round(precisionM))} m).`,
        );
      },
      (err) => {
        setLocalisation(false);
        setAvis({
          type: "erreur",
          texte:
            err.code === err.PERMISSION_DENIED
              ? "La position a été refusée : autorisez la localisation pour cette application, ou saisissez les coordonnées à la main."
              : "Position indisponible : rapprochez-vous d'une fenêtre et réessayez, ou saisissez les coordonnées à la main.",
        });
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    );
  }

  function enregistrerSaisie() {
    const c = lireCoordonneesSaisies(saisie);
    if (!c) {
      setAvis({ type: "erreur", texte: "Coordonnées illisibles : collez-les au format « -4.3217, 15.3125 » (latitude, longitude)." });
      return;
    }
    executer(() => reglerPositionRestaurant({ ...c, precisionM: null }), "Position du restaurant enregistrée (saisie manuelle).");
    setSaisie("");
  }

  function enregistrerRayon(formData: FormData) {
    const rayon = Number(formData.get("rayonM"));
    executer(() => reglerRayon(rayon), `Rayon toléré enregistré : ${formaterNombre(rayon)} m.`);
  }

  return (
    <div className="space-y-5 text-sm">
      <p className="max-w-2xl text-muted-foreground">
        Les salariés pointent en scannant l&apos;affiche collée au restaurant. Leur téléphone donne sa position au même
        moment : un scan hors du rayon est enregistré quand même, et marqué « à vérifier » dans le suivi.
      </p>

      {avis && (
        <p
          role={avis.type === "erreur" ? "alert" : "status"}
          className={
            avis.type === "erreur"
              ? "rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive"
              : "rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-emerald-800"
          }
        >
          {avis.texte}
        </p>
      )}

      {/* Position du restaurant */}
      <div className="space-y-2">
        <h3 className="font-medium">Position du restaurant</h3>
        {positionReglee ? (
          <p>
            {/* Au format du champ de saisie (point décimal) : se recopie tel quel. */}
            Latitude, longitude <b className="select-all tabular-nums">{coordonneesSaisissables(reglages.lat!, reglages.lng!)}</b>
            {reglages.mesure && <span className="text-muted-foreground"> · {reglages.mesure}</span>}{" "}
            <a
              href={`https://www.google.com/maps?q=${reglages.lat},${reglages.lng}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline"
            >
              Voir sur la carte
            </a>
          </p>
        ) : (
          <p className="text-amber-800">Pas encore réglée : l&apos;affiche ne peut pas être imprimée.</p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <BoutonNeutre type="button" onClick={utiliserMaPosition} disabled={enCours || localisation}>
            {localisation ? "Localisation…" : "Utiliser ma position actuelle"}
          </BoutonNeutre>
          <span className="text-xs text-muted-foreground">
            Sur place, au restaurant. Précision exigée : {formaterNombre(PRECISION_REGLAGE_MAX_M)} m au plus.
          </span>
        </div>
        <div className="flex flex-col gap-1 pt-1">
          <label htmlFor="pointage-coordonnees" className="text-xs text-muted-foreground">
            Ou saisissez les coordonnées copiées depuis Google Maps (appui long sur le restaurant, puis copier) :
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              id="pointage-coordonnees"
              type="text"
              inputMode="decimal"
              value={saisie}
              onChange={(e) => setSaisie(e.target.value)}
              placeholder="-4.3217, 15.3125"
              className={`${inputCls} w-full max-w-xs`}
            />
            <button type="button" onClick={enregistrerSaisie} disabled={enCours || !saisie.trim()} className={CLASSES_ENREGISTRER}>
              Enregistrer ces coordonnées
            </button>
          </div>
        </div>
      </div>

      {/* Rayon */}
      <form action={enregistrerRayon} className="space-y-1">
        <label htmlFor="pointage-rayon" className="block font-medium">
          Rayon toléré
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            id="pointage-rayon"
            name="rayonM"
            type="number"
            inputMode="numeric"
            min={50}
            max={1000}
            step={1}
            defaultValue={reglages.rayonM}
            className={`${inputCls} w-28 text-right`}
          />
          <span className="text-muted-foreground">mètres (de 50 à 1 000)</span>
          <button type="submit" disabled={enCours} className={CLASSES_ENREGISTRER}>
            Enregistrer le rayon
          </button>
        </div>
      </form>

      {/* Affiche */}
      <div className="space-y-2">
        <h3 className="font-medium">Affiche</h3>
        {positionReglee ? (
          <div className="flex flex-wrap items-center gap-2">
            <TelechargerLien href="/parametres/pointage/affiche" nomFichier="Affiche-pointage.pdf" className={CLASSES_NEUTRE}>
              Imprimer l&apos;affiche
            </TelechargerLien>
            <form action={() => executer(() => changerCodeAffiche(), "Nouveau code enregistré : imprimez et collez la nouvelle affiche.")}>
              <ConfirmSubmitButton
                message="Changer le code de l'affiche ? Les affiches déjà imprimées ne marcheront plus : il faudra imprimer et coller la nouvelle."
                className={CLASSES_DANGER}
              >
                Changer le code
              </ConfirmSubmitButton>
            </form>
          </div>
        ) : (
          <p className="text-amber-800">{MESSAGE_POSITION_NON_REGLEE}</p>
        )}
        <p className="max-w-2xl text-xs text-muted-foreground">
          Réimprimer donne la même affiche. « Changer le code » rend inutilisables toutes les affiches déjà imprimées
          (une photo circule, une affiche a été emportée).
        </p>
      </div>
    </div>
  );
}

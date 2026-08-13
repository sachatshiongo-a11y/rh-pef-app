"use client";

import { useState } from "react";
import { calculerTicksAxe } from "@/lib/exploitation/graphiques";
import { LegendeGraphique, type EntreeLegende } from "./legende-graphique";
import { InfobulleGraphique, type LigneInfobulle } from "./infobulle-graphique";
import { SerieLigneSvg } from "./serie-ligne";
import { SerieBarresSvg } from "./serie-barres";
import type { SerieConfig, SerieBarresConfig, SerieLigneConfig, BandeReference } from "./types";

const MARGE = { haut: 16, bas: 24, gauche: 60, droite: 12 };
const LARGEUR_VIEWBOX = 760;

/**
 * Graphique cartésien SVG maison — UNE seule échelle Y (jamais de double axe, règle impérative
 * dataviz de cette Task) : toutes les séries reçues partagent le même domaine, calculé via
 * `calculerTicksAxe` (inclut toujours 0). Compose `SerieLigneSvg`/`SerieBarresSvg` (le tracé),
 * `LegendeGraphique` (obligatoire dès 2 séries) et `InfobulleGraphique` (survol). Grille/axes en
 * `--border`/`--muted-foreground`, discrets ; texte toujours en encre neutre.
 *
 * Interaction de survol SIMPLIFIÉE volontairement : une cible par MOIS (bande pleine hauteur,
 * plus grande que chaque marque) plutôt qu'une cible par forme — le crosshair sert les séries
 * lignes, l'infobulle liste alors la valeur de CHAQUE série du mois (y compris les barres), ce qui
 * couvre « infobulle sur les lignes » et « infobulle par barre » avec une seule mécanique de survol
 * (accessible au clavier via `tabIndex`/`onFocus`, en plus de la vue Tableau).
 */
export function GraphiqueCartesien({
  mois,
  series,
  formatValeur,
  formatTick,
  hauteur = 220,
  bandesReference = [],
  legende = [],
  titre = "Graphique",
}: {
  mois: string[];
  series: SerieConfig[];
  formatValeur: (n: number) => string;
  formatTick?: (n: number) => string;
  hauteur?: number;
  bandesReference?: BandeReference[];
  legende?: EntreeLegende[];
  titre?: string;
}) {
  const [survole, setSurvole] = useState<number | null>(null);

  const zoneW = LARGEUR_VIEWBOX - MARGE.gauche - MARGE.droite;
  const zoneH = hauteur - MARGE.haut - MARGE.bas;
  const n = Math.max(mois.length, 1);
  const bandeW = zoneW / n;
  const xCentre = (i: number) => MARGE.gauche + bandeW * (i + 0.5);

  // Domaine Y commun à TOUTES les séries + bandes de référence — c'est ce qui garantit une échelle
  // unique (pas de deuxième axe caché derrière des unités différentes).
  const toutesValeurs = [
    ...series.flatMap((s) => s.valeurs.filter((v): v is number => v !== null)),
    ...bandesReference.map((b) => b.valeur),
  ];
  const min = toutesValeurs.length ? Math.min(...toutesValeurs) : 0;
  const max = toutesValeurs.length ? Math.max(...toutesValeurs) : 1;
  const ticks = calculerTicksAxe(min, max, 4);
  const domMin = ticks[0];
  const domMax = ticks[ticks.length - 1];
  const yPix = (v: number) => MARGE.haut + zoneH - ((v - domMin) / (domMax - domMin || 1)) * zoneH;

  const tickFmt = formatTick ?? formatValeur;

  const seriesBarres = series.filter((s): s is SerieBarresConfig => s.type === "barres");
  const seriesLignes = series.filter((s): s is SerieLigneConfig => s.type === "ligne");
  // Un seul groupe de barres par graphique dans cette Task (résultat, couverts) — largeur pleine
  // moins un écart de 2px de chaque côté (règle « écart 2px entre barres »).
  const largeurBarre = Math.max(6, bandeW - 4);

  const lignesInfobulle: LigneInfobulle[] =
    survole === null
      ? []
      : series.map((s) => {
          const v = s.valeurs[survole];
          const couleur = s.type === "barres" ? s.couleur(v ?? 0, survole) : s.couleur;
          return { label: s.label, couleur, texte: v === null ? "—" : formatValeur(v), pointille: s.type === "ligne" && s.pointille };
        });

  return (
    <div className="space-y-2">
      <div className="relative overflow-x-auto">
        <svg viewBox={`0 0 ${LARGEUR_VIEWBOX} ${hauteur}`} className="w-full min-w-[480px]" role="img" aria-label={titre}>
          {/* Grille horizontale + graduations Y — discrètes. */}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={MARGE.gauche} x2={LARGEUR_VIEWBOX - MARGE.droite} y1={yPix(t)} y2={yPix(t)} style={{ stroke: "var(--border)" }} strokeWidth={1} />
              <text x={MARGE.gauche - 6} y={yPix(t)} textAnchor="end" dominantBaseline="middle" fontSize={10} style={{ fill: "var(--muted-foreground)" }}>
                {tickFmt(t)}
              </text>
            </g>
          ))}

          {/* Axe X — libellés des mois (Janv…Déc). */}
          {mois.map((m, i) => (
            <text key={m} x={xCentre(i)} y={hauteur - 6} textAnchor="middle" fontSize={10} style={{ fill: "var(--muted-foreground)" }}>
              {m}
            </text>
          ))}

          {/* Bandes de référence (idéal/max de chaque ratio, seuil...) — gris clair pointillé,
              jamais la couleur d'une série (identité déjà portée par l'étiquette). */}
          {bandesReference.map((b, i) => (
            <g key={i}>
              <line
                x1={MARGE.gauche} x2={LARGEUR_VIEWBOX - MARGE.droite} y1={yPix(b.valeur)} y2={yPix(b.valeur)}
                style={{ stroke: "var(--muted-foreground)" }} strokeOpacity={0.35} strokeDasharray="3 3" strokeWidth={1}
              />
              {b.etiquette && (
                <text x={LARGEUR_VIEWBOX - MARGE.droite - 2} y={yPix(b.valeur) - 3} textAnchor="end" fontSize={9} style={{ fill: "var(--muted-foreground)" }}>
                  {b.etiquette}
                </text>
              )}
            </g>
          ))}

          {seriesBarres.map((s) => (
            <SerieBarresSvg key={s.cle} serie={s} xCentre={xCentre} yPix={yPix} yZero={yPix(0)} largeurBarre={largeurBarre} />
          ))}
          {seriesLignes.map((s) => (
            <SerieLigneSvg key={s.cle} serie={s} xCentre={xCentre} yPix={yPix} formatValeur={formatValeur} />
          ))}

          {survole !== null && (
            <line
              x1={xCentre(survole)} x2={xCentre(survole)} y1={MARGE.haut} y2={hauteur - MARGE.bas}
              style={{ stroke: "var(--muted-foreground)" }} strokeOpacity={0.5} strokeWidth={1}
            />
          )}

          {/* Cibles de survol — une bande PAR MOIS, plus grande que chaque marque (règle dataviz),
              couvrant toute la hauteur du tracé ; accessible au clavier via `onFocus`. */}
          {mois.map((m, i) => (
            <rect
              key={`hit-${m}-${i}`}
              x={MARGE.gauche + bandeW * i}
              y={MARGE.haut}
              width={bandeW}
              height={zoneH}
              fill="transparent"
              tabIndex={0}
              onPointerEnter={() => setSurvole(i)}
              onPointerMove={() => setSurvole(i)}
              onPointerLeave={() => setSurvole((s) => (s === i ? null : s))}
              onFocus={() => setSurvole(i)}
              onBlur={() => setSurvole((s) => (s === i ? null : s))}
              aria-label={`${m} : ${series.map((s) => `${s.label} ${s.valeurs[i] === null ? "non renseigné" : formatValeur(s.valeurs[i] as number)}`).join(", ")}`}
            />
          ))}
        </svg>

        {survole !== null && <InfobulleGraphique titre={mois[survole]} lignes={lignesInfobulle} xPourcent={((survole + 0.5) / n) * 100} />}
      </div>

      <LegendeGraphique entrees={legende} />
    </div>
  );
}

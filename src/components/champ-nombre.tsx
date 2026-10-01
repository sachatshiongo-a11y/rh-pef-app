"use client";

import { useState, type InputHTMLAttributes } from "react";
import { aSeparateur, conseilSaisie, lireNombreSaisi } from "@/lib/nombre";

/**
 * Champ de NOMBRE saisi à la française (défaut du 2026-10-01) : remplace le champ numérique natif du navigateur,
 * dont le navigateur lisait « 150.000 » comme 150 et refusait « 1.500,5 ». Règle de Sacha :
 * virgule = décimale ; point et espace = milliers (`lireNombreSaisi`).
 *
 * - Champ TEXTE avec clavier décimal sur téléphone (`inputMode="decimal"`).
 * - Sous le champ, ce que l'application a LU, dès que la saisie contient un séparateur
 *   (« lu : 150 000 FC ») — ou « illisible » en rouge. Sans séparateur, rien n'est ambigu : rien ne
 *   s'affiche, la ligne ne grandit pas.
 * - `alerteMilliers` (quantités) : « 1.500 » est lu mille cinq cents et l'écran le signale en
 *   orange — un kilo et demi s'écrit « 1,5 ».
 * - Contrôlé (`value` + `onChange`) ou non (`defaultValue`) comme un `<input>` ordinaire ; le
 *   serveur relit la valeur brute avec `decSaisi` / `decSaisiOptionnel`.
 * - `classeConteneur` : classes de l'enveloppe (largeur, colonne de grille) ; `className` va au champ.
 */
export function ChampNombre({
  suffixe = "", alerteMilliers = false, classeConteneur = "", montrerLu = true, value, defaultValue, onChange, ...reste
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  suffixe?: string; alerteMilliers?: boolean; classeConteneur?: string; montrerLu?: boolean;
}) {
  const [interne, setInterne] = useState(String(defaultValue ?? ""));
  const texte = value !== undefined && value !== null ? String(value) : interne;
  return (
    <span className={`inline-flex min-w-0 flex-col gap-0.5 ${classeConteneur}`}>
      <input
        {...reste}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        {...(value !== undefined ? { value: value ?? "" } : { defaultValue })}
        onChange={(e) => { if (value === undefined) setInterne(e.target.value); onChange?.(e); }}
      />
      {montrerLu && <LuNombre texte={texte} suffixe={suffixe} alerteMilliers={alerteMilliers} />}
    </span>
  );
}

/** Ligne « lu : … » sous un champ de nombre — exportée pour les champs qui ne passent pas par `ChampNombre`. */
export function LuNombre({ texte, suffixe = "", alerteMilliers = false }: { texte: string; suffixe?: string; alerteMilliers?: boolean }) {
  const t = texte.trim();
  if (!t) return null;
  const n = lireNombreSaisi(t);
  if (n === null) {
    const conseil = conseilSaisie(t);
    return <span className="text-[10px] font-medium leading-tight text-destructive">illisible{conseil ? ` — ${conseil}` : ""}</span>;
  }
  const milliers = alerteMilliers && /^\d{1,3}\.\d{3}$/.test(t);
  // « 1,125 » / « 150,000 » : la virgule est la décimale (lu 1,125 et 150) — on MONTRE ce qui est lu,
  // en gris, sans conseil : c'est une valeur juste dans la règle, pas une erreur.
  const virguleTroisDecimales = /^[1-9]\d{0,2},\d{3}$/.test(t);
  if (!aSeparateur(t) && !milliers && !virguleTroisDecimales) return null;
  const lu = `lu : ${n.toLocaleString("fr-FR", { maximumFractionDigits: 4 })}${suffixe ? ` ${suffixe}` : ""}`;
  return milliers
    ? <span className="text-[10px] font-medium leading-tight text-amber-700">{lu} — milliers ? (1,5 pour un et demi)</span>
    : <span className="text-[10px] leading-tight text-muted-foreground">{lu}</span>;
}

// Shift sérialisable passé aux composants clients.
export type ShiftDTO = {
  id: string;
  nom: string;
  heureDebut: string | null;
  heureFin: string | null;
  couleur: string;
  ordre: number;
  systeme: boolean;
  actif: boolean;
  dureeHeures: number | null;
  tauxHoraireUSD: number | null;
};

/** Durée d'un shift en heures : `dureeHeures` explicite, sinon calculée depuis les horaires (gère la nuit). */
export function dureeShift(s: { heureDebut: string | null; heureFin: string | null; dureeHeures: number | null }): number {
  if (s.dureeHeures != null) return s.dureeHeures;
  if (!s.heureDebut || !s.heureFin) return 0;
  const [hd, md] = s.heureDebut.split(":").map(Number);
  const [hf, mf] = s.heureFin.split(":").map(Number);
  let minutes = hf * 60 + mf - (hd * 60 + md);
  if (minutes < 0) minutes += 24 * 60; // shift de nuit (fin le lendemain)
  return Math.round((minutes / 60) * 100) / 100;
}

// Palette de couleurs disponibles pour les shifts (clé -> classes Tailwind + hex pour la grille).
export const PALETTE: Record<string, { classe: string; hex: { bg: string; text: string } }> = {
  yellow: { classe: "bg-yellow-100 text-yellow-800", hex: { bg: "#fef9c3", text: "#854d0e" } },
  orange: { classe: "bg-orange-100 text-orange-800", hex: { bg: "#ffedd5", text: "#9a3412" } },
  purple: { classe: "bg-purple-100 text-purple-800", hex: { bg: "#f3e8ff", text: "#6b21a8" } },
  indigo: { classe: "bg-indigo-100 text-indigo-800", hex: { bg: "#e0e7ff", text: "#3730a3" } },
  slate: { classe: "bg-slate-100 text-slate-600", hex: { bg: "#f1f5f9", text: "#475569" } },
  blue: { classe: "bg-blue-100 text-blue-800", hex: { bg: "#dbeafe", text: "#1e40af" } },
  pink: { classe: "bg-pink-100 text-pink-800", hex: { bg: "#fce7f3", text: "#9d174d" } },
  green: { classe: "bg-green-100 text-green-800", hex: { bg: "#dcfce7", text: "#166534" } },
  teal: { classe: "bg-teal-100 text-teal-800", hex: { bg: "#ccfbf1", text: "#115e59" } },
  rose: { classe: "bg-rose-100 text-rose-800", hex: { bg: "#ffe4e6", text: "#9f1239" } },
};

export const COULEURS_DISPO = Object.keys(PALETTE);

export function paletteDe(couleur: string) {
  return PALETTE[couleur] ?? PALETTE.indigo;
}

/** Libellé complet d'un shift, avec heures si définies (ex. « Matin 08:00–14:00 »). */
export function libelleShift(nom: string, heureDebut: string | null, heureFin: string | null): string {
  return heureDebut && heureFin ? `${nom} ${heureDebut}–${heureFin}` : nom;
}

// `pariteSemaine` vit désormais dans src/lib/dates-fr.ts : le moteur pur (src/lib/planning-auto.ts)
// en a besoin et ne doit rien importer de src/app/. Ré-exporté ici pour les appelants existants.
export { pariteSemaine } from "@/lib/dates-fr";

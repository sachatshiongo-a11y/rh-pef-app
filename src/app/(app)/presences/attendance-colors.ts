import type { CodePresence } from "@/lib/payroll";

/** Couleur associée à chaque code de présence — réutilisée dans la légende et la grille. */
export const COULEUR_CODE: Record<CodePresence, string> = {
  P: "bg-green-100 text-green-800",
  O: "bg-blue-100 text-blue-800",
  M: "bg-amber-100 text-amber-800",
  A: "bg-sky-100 text-sky-800",
  N: "bg-red-100 text-red-800",
  C: "bg-purple-100 text-purple-800",
  F: "bg-pink-100 text-pink-800",
  S: "bg-slate-200 text-slate-700",
};

/** Mêmes couleurs qu'en hexadécimal, pour un style inline appliqué dynamiquement dans la grille. */
export const COULEUR_CODE_HEX: Record<CodePresence, { bg: string; text: string }> = {
  P: { bg: "#dcfce7", text: "#166534" },
  O: { bg: "#dbeafe", text: "#1e40af" },
  M: { bg: "#fef3c7", text: "#92400e" },
  A: { bg: "#e0f2fe", text: "#075985" },
  N: { bg: "#fee2e2", text: "#991b1b" },
  C: { bg: "#f3e8ff", text: "#6b21a8" },
  F: { bg: "#fce7f3", text: "#9d174d" },
  S: { bg: "#e2e8f0", text: "#334155" },
};

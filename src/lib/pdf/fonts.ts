import path from "node:path";
import { Font } from "@react-pdf/renderer";

let registered = false;

/**
 * Police Optima extraite depuis /System/Library/Fonts/Optima.ttc (macOS) et embarquée dans
 * assets/fonts/ pour un usage interne à l'entreprise (documents RH générés par le serveur).
 * Optima étant une police propriétaire (Apple/Linotype), ces fichiers ne doivent pas être
 * redistribués en dehors de cet usage interne.
 */
export function registerPdfFonts() {
  if (registered) return;
  registered = true;

  const dir = path.join(process.cwd(), "assets/fonts");

  Font.register({
    family: "Optima",
    fonts: [
      { src: path.join(dir, "Optima-Regular.ttf"), fontWeight: 400 },
      { src: path.join(dir, "Optima-Bold.ttf"), fontWeight: 700 },
      { src: path.join(dir, "Optima-Italic.ttf"), fontWeight: 400, fontStyle: "italic" },
    ],
  });
}

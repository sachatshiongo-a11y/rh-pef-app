import JSZip from "jszip";
import { exigerEspaceRH } from "@/lib/garde-route";
import { genererFichePostePdf } from "@/lib/pdf/fiche-poste-buffer";

/**
 * Plusieurs fiches de poste d'un coup (barre d'actions groupées) : chaque PDF est EXACTEMENT celui
 * de la route unitaire (`genererFichePostePdf`), un fichier par fiche, regroupés dans un ZIP —
 * même modèle que les bulletins (`paie/bulletins-zip`). Direction / Manager, comme l'unitaire.
 */
export async function GET(request: Request) {
  const g = await exigerEspaceRH({ roles: ["ADMIN", "MANAGER"] });
  if (!g.ok) return g.reponse;
  const ids = [...new Set((new URL(request.url).searchParams.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean))].slice(0, 200);
  if (ids.length === 0) return new Response("Aucune fiche sélectionnée", { status: 400 });

  const zip = new JSZip();
  const utilises = new Set<string>();
  for (const id of ids) {
    const pdf = await genererFichePostePdf(id);
    if (!pdf) continue;
    // Deux postes qui donnent le même nom de fichier (accents retirés) : suffixe, jamais d'écrasement.
    const base = pdf.nomFichier.replace(/\.pdf$/i, "");
    let nom = base;
    for (let n = 2; utilises.has(nom); n++) nom = `${base}_${n}`;
    utilises.add(nom);
    zip.file(`${nom}.pdf`, pdf.buffer);
  }
  if (utilises.size === 0) return new Response("Fiches de poste introuvables", { status: 404 });

  const contenu = await zip.generateAsync({ type: "nodebuffer" });
  return new Response(new Uint8Array(contenu), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="Fiches_de_poste.zip"`,
    },
  });
}

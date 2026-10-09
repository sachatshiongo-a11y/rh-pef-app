import JSZip from "jszip";
import { exigerEspaceRH } from "@/lib/garde-route";
import { genererDemandeCongePdf } from "@/lib/pdf/demande-conge-buffer";
import { MAX_DEMANDES_PAR_LOT } from "@/lib/conges-liste";

/**
 * Plusieurs demandes de congé d'un coup (barre d'actions groupées de l'écran Congés) : chaque PDF est
 * EXACTEMENT celui de la route unitaire (`genererDemandeCongePdf` : solde figé, signature…), un fichier par
 * demande, regroupés dans un ZIP — même modèle que les fiches de poste (`fiches-poste/pdf-lot`). Mêmes
 * droits que la route unitaire (`/conges/demande/[id]`) : toute l'équipe RH.
 */
export async function GET(request: Request) {
  const g = await exigerEspaceRH();
  if (!g.ok) return g.reponse;
  const ids = [...new Set((new URL(request.url).searchParams.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean))];
  if (ids.length === 0) return new Response("Aucune demande sélectionnée", { status: 400 });
  // Refus explicite plutôt qu'un ZIP tronqué en silence (l'écran ne propose pas le lien au-delà).
  if (ids.length > MAX_DEMANDES_PAR_LOT) return new Response(`${MAX_DEMANDES_PAR_LOT} demandes au plus par lot`, { status: 400 });

  const zip = new JSZip();
  const utilises = new Set<string>();
  for (const id of ids) {
    const pdf = await genererDemandeCongePdf(id);
    if (!pdf) continue;
    // Deux demandes qui donnent le même nom de fichier (même salarié, même type) : suffixe, jamais d'écrasement.
    const base = pdf.nomFichier.replace(/\.pdf$/i, "");
    let nom = base;
    for (let n = 2; utilises.has(nom); n++) nom = `${base}_${n}`;
    utilises.add(nom);
    zip.file(`${nom}.pdf`, pdf.buffer);
  }
  if (utilises.size === 0) return new Response("Demandes de congé introuvables", { status: 404 });

  const contenu = await zip.generateAsync({ type: "nodebuffer" });
  return new Response(new Uint8Array(contenu), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="Demandes_de_conge.zip"`,
    },
  });
}

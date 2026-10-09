import JSZip from "jszip";
import { exigerEspaceRH } from "@/lib/garde-route";
import { genererFichePostePdf } from "@/lib/pdf/fiche-poste-buffer";
import { MAX_FICHES_PAR_LOT } from "@/lib/fiches-poste-liste";

/**
 * Plusieurs fiches de poste d'un coup (barre d'actions groupées) : chaque PDF est EXACTEMENT celui
 * de la route unitaire (`genererFichePostePdf`), un fichier par fiche, regroupés dans un ZIP —
 * même modèle que les bulletins (`paie/bulletins-zip`). Direction / Manager, comme l'unitaire.
 */
export async function GET(request: Request) {
  const g = await exigerEspaceRH({ roles: ["ADMIN", "MANAGER"] });
  if (!g.ok) return g.reponse;
  const ids = [...new Set((new URL(request.url).searchParams.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean))];
  if (ids.length === 0) return new Response("Aucune fiche sélectionnée", { status: 400 });
  // Refus explicite plutôt qu'un ZIP tronqué en silence (l'écran ne propose pas le lien au-delà).
  if (ids.length > MAX_FICHES_PAR_LOT) return new Response(`${MAX_FICHES_PAR_LOT} fiches au plus par lot`, { status: 400 });

  const zip = new JSZip();
  const utilises = new Set<string>();
  let introuvables = 0;
  for (const id of ids) {
    const pdf = await genererFichePostePdf(id);
    if (!pdf) { introuvables++; continue; }
    // Deux postes qui donnent le même nom de fichier (accents retirés) : suffixe, jamais d'écrasement.
    const base = pdf.nomFichier.replace(/\.pdf$/i, "");
    let nom = base;
    for (let n = 2; utilises.has(nom); n++) nom = `${base}_${n}`;
    utilises.add(nom);
    zip.file(`${nom}.pdf`, pdf.buffer);
  }
  if (utilises.size === 0) return new Response("Fiches de poste introuvables", { status: 404 });

  // Une fiche supprimée entre-temps manque au ZIP : on le DIT, jamais en silence.
  if (introuvables > 0) {
    zip.file("LISEZMOI.txt", `${introuvables} fiche(s) sur ${ids.length} n'ont pas été trouvées (supprimées depuis la sélection ?) et ne figurent pas dans cette archive.\r\n`);
  }
  const contenu = await zip.generateAsync({ type: "nodebuffer" });
  return new Response(new Uint8Array(contenu), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="Fiches_de_poste.zip"`,
    },
  });
}

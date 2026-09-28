import { exigerEspaceRH } from "@/lib/garde-route";
import { classeurExcel } from "@/lib/export-excel";
import { chargerRegistre, filtresRegistre, ENTETE_REGISTRE, ligneRegistre } from "../_registre";

/** Export Excel du registre des attestations — FIDÈLE à l'onglet (mêmes filtres type et statut). */
export async function GET(request: Request) {
  const g = await exigerEspaceRH();
  if (!g.ok) return g.reponse;
  const filtres = filtresRegistre(new URL(request.url).searchParams);
  const lignes = (await chargerRegistre(filtres)).map(ligneRegistre);
  const buf = await classeurExcel({
    titre: "Registre des attestations",
    periode: `${lignes.length} attestation(s)`,
    feuilles: [{ nom: "Attestations", entete: ENTETE_REGISTRE, lignes, autofiltre: true, messageVide: "Aucune attestation" }],
  });
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Registre_attestations.xlsx"`,
    },
  });
}

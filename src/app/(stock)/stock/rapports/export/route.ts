import { renderToBuffer } from "@react-pdf/renderer";
import { prisma } from "@/lib/prisma";
import { verifySession, requireModule } from "@/lib/auth";
import { classeurExcel } from "@/lib/export-excel";
import { TableauDocument, type Colonne } from "@/lib/pdf/tableau";
import { genererDonneesRapport, genererDonneesRapportDetail, TYPES_RAPPORT, type TypeRapport } from "@/lib/rapports";

function bornes(sp: URLSearchParams): { debut: Date; fin: Date } {
  const now = new Date();
  const defFin = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const defDebut = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));
  const pd = sp.get("debut"), pf = sp.get("fin");
  const debut = pd && /^\d{4}-\d{2}$/.test(pd) ? new Date(`${pd}-01T00:00:00Z`) : defDebut;
  const fin = pf && /^\d{4}-\d{2}$/.test(pf) ? new Date(`${pf}-01T00:00:00Z`) : defFin;
  return { debut, fin };
}
const moisLabel = (d: Date) => d.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });

export async function GET(req: Request) {
  const user = await verifySession();
  requireModule(user, "stock");

  const sp = new URL(req.url).searchParams;
  const type = sp.get("type") as TypeRapport;
  if (!type || !(type in TYPES_RAPPORT)) return new Response("Type de rapport inconnu", { status: 400 });
  const format = sp.get("format") === "excel" ? "excel" : "pdf";
  const mode = sp.get("mode") === "detail" ? "detail" : "chiffre";
  const { debut, fin } = bornes(sp);

  const data = mode === "detail" ? await genererDonneesRapportDetail(type, debut, fin) : await genererDonneesRapport(type, debut, fin);
  const periode = `${moisLabel(debut)} → ${moisLabel(fin)}`;

  // Journalise la génération (avec mode/format pour re-télécharger depuis les archives).
  await prisma.rapport.create({ data: { titre: data.titre, type, mode, format, periodeDebut: debut, periodeFin: fin, creeParId: user.id } });

  if (format === "excel") {
    const buf = await classeurExcel({
      titre: `Rapport — ${data.titre}`,
      periode,
      feuilles: [{ nom: data.titre.slice(0, 28), entete: data.entete, lignes: data.lignes, totauxCols: data.sommables, variationCol: data.variationCol }],
    });
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="Rapport_${type}_${mode}_${new Date().toISOString().slice(0, 10)}.xlsx"`,
      },
    });
  }

  const colonnes: Colonne[] = data.entete.map((header, i) => ({ header, width: data.largeurs[i] ?? "auto", align: data.droite.includes(i) ? "right" : "left" }));
  // Ligne « Total » en bas (somme des colonnes sommables) pour le PDF.
  let lignesPdf = data.lignes;
  if (data.sommables && data.sommables.length > 0) {
    const tot: (string | number)[] = new Array(data.entete.length).fill("");
    tot[0] = "Total";
    for (const ci of data.sommables) {
      let s = 0;
      for (const l of data.lignes) { const v = Number(l[ci]); if (Number.isFinite(v)) s += v; }
      tot[ci] = Math.round(s * 100) / 100;
    }
    lignesPdf = [...data.lignes, tot];
  }
  const buffer = await renderToBuffer(TableauDocument({ titre: `Rapport — ${data.titre}`, sousTitre: periode, colonnes, lignes: lignesPdf, totalDerniereLigne: !!(data.sommables && data.sommables.length) }));
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="Rapport_${type}_${mode}_${new Date().toISOString().slice(0, 10)}.pdf"`,
    },
  });
}

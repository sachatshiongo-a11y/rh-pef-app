import { renderToBuffer } from "@react-pdf/renderer";
import { prisma } from "@/lib/prisma";
import { verifySession, requireModule } from "@/lib/auth";
import { classeurExcel } from "@/lib/export-excel";
import { TableauDocument, type Colonne } from "@/lib/pdf/tableau";
import { genererDonneesRapport, TYPES_RAPPORT, type TypeRapport } from "@/lib/rapports";

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
  const { debut, fin } = bornes(sp);

  const data = await genererDonneesRapport(type, debut, fin);
  const periode = `${moisLabel(debut)} → ${moisLabel(fin)}`;

  // Journalise la génération.
  await prisma.rapport.create({ data: { titre: data.titre, type, periodeDebut: debut, periodeFin: fin, creeParId: user.id } });

  if (format === "excel") {
    const buf = await classeurExcel({
      titre: `Rapport — ${data.titre}`,
      periode,
      feuilles: [{ nom: data.titre.slice(0, 28), entete: data.entete, lignes: data.lignes }],
    });
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="Rapport_${type}_${new Date().toISOString().slice(0, 10)}.xlsx"`,
      },
    });
  }

  const colonnes: Colonne[] = data.entete.map((header, i) => ({ header, width: data.largeurs[i] ?? "auto", align: data.droite.includes(i) ? "right" : "left" }));
  const buffer = await renderToBuffer(TableauDocument({ titre: `Rapport — ${data.titre}`, sousTitre: periode, colonnes, lignes: data.lignes }));
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="Rapport_${type}_${new Date().toISOString().slice(0, 10)}.pdf"`,
    },
  });
}

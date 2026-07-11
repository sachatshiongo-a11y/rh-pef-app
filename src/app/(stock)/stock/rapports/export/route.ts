import { renderToBuffer } from "@react-pdf/renderer";
import { prisma } from "@/lib/prisma";
import { verifySession, requireModule } from "@/lib/auth";
import { classeurExcel, type FeuilleExcel } from "@/lib/export-excel";
import { TableauDocument, TablesDocument, type Colonne, type TableSpec } from "@/lib/pdf/tableau";
import { genererDonneesRapport, genererDonneesRapportDetail, TYPES_RAPPORT, type TypeRapport } from "@/lib/rapports";

/** Construit un TableSpec PDF (colonnes + lignes avec ligne Total) depuis les champs d'un tableau de rapport. */
function versTableSpec(t: { entete: string[]; lignes: (string | number)[][]; largeurs: string[]; droite: number[]; sommables?: number[] }, sousTitre?: string): TableSpec {
  const colonnes: Colonne[] = t.entete.map((header, i) => ({ header, width: t.largeurs[i] ?? "auto", align: t.droite.includes(i) ? "right" : "left" }));
  let lignes = t.lignes;
  if (t.sommables?.length) {
    const tot: (string | number)[] = new Array(t.entete.length).fill("");
    tot[0] = "Total";
    for (const ci of t.sommables) { let s = 0; for (const l of t.lignes) { const v = Number(l[ci]); if (Number.isFinite(v)) s += v; } tot[ci] = Math.round(s * 100) / 100; }
    lignes = [...t.lignes, tot];
  }
  return { sousTitre, colonnes, lignes, totalDerniereLigne: !!t.sommables?.length };
}

function bornes(sp: URLSearchParams): { debut: Date; fin: Date } {
  const now = new Date();
  const defFin = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const defDebut = new Date(Date.UTC(now.getUTCFullYear() - 1, now.getUTCMonth(), now.getUTCDate()));
  const pd = sp.get("debut"), pf = sp.get("fin");
  const debut = pd && /^\d{4}-\d{2}-\d{2}$/.test(pd) ? new Date(`${pd}T00:00:00Z`) : defDebut;
  const fin = pf && /^\d{4}-\d{2}-\d{2}$/.test(pf) ? new Date(`${pf}T00:00:00Z`) : defFin;
  return { debut, fin };
}
const jourLabel = (d: Date) => d.toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" });

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
  const periode = `${jourLabel(debut)} → ${jourLabel(fin)}`;

  // Journalise la génération (avec mode/format pour re-télécharger depuis les archives).
  await prisma.rapport.create({ data: { titre: data.titre, type, mode, format, periodeDebut: debut, periodeFin: fin, creeParId: user.id } });

  if (format === "excel") {
    const feuilles: FeuilleExcel[] = [{ nom: (data.soustitre ?? data.titre).slice(0, 28), entete: data.entete, lignes: data.lignes, totauxCols: data.sommables, variationCol: data.variationCol }];
    if (data.table2) feuilles.push({ nom: data.table2.titre.slice(0, 28), entete: data.table2.entete, lignes: data.table2.lignes, totauxCols: data.table2.sommables });
    const buf = await classeurExcel({ titre: `Rapport — ${data.titre}`, periode, feuilles });
    return new Response(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="Rapport_${type}_${mode}_${new Date().toISOString().slice(0, 10)}.xlsx"`,
      },
    });
  }

  // PDF : un ou deux tableaux (synthèse + détail) selon le rapport.
  const buffer = data.table2
    ? await renderToBuffer(TablesDocument({ titre: `Rapport — ${data.titre}`, sousTitre: periode, tables: [versTableSpec(data, data.soustitre), versTableSpec(data.table2, data.table2.titre)] }))
    : await renderToBuffer(TableauDocument({ ...versTableSpec(data), titre: `Rapport — ${data.titre}`, sousTitre: periode }));
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="Rapport_${type}_${mode}_${new Date().toISOString().slice(0, 10)}.pdf"`,
    },
  });
}

import { renderToBuffer } from "@react-pdf/renderer";
import { verifySession } from "@/lib/auth";
import { TableauDocument, type Colonne } from "@/lib/pdf/tableau";
import { donneesPlanning } from "../export-data";

/** Planning (semaine ou mois) en PDF paysage : employés × jours, groupé Brigade/Backoffice. */
export async function GET(req: Request) {
  await verifySession();
  const { titre, sousTitre, fichierBase, labels, lignes, sectionRows } = await donneesPlanning(new URL(req.url).searchParams);

  const empPct = labels.length > 14 ? 12 : 20;
  const dayW = `${(100 - empPct) / labels.length}%`;
  const colonnes: Colonne[] = [
    { header: "Employé", width: `${empPct}%` },
    ...labels.map((l) => ({ header: l, width: dayW, align: "center" as const })),
  ];

  const buffer = await renderToBuffer(
    TableauDocument({ titre, sousTitre, colonnes, lignes, sectionRows, paysage: true, pied: "« — » = repos. Planning prévisionnel." }),
  );
  return new Response(new Uint8Array(buffer), {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${fichierBase}.pdf"` },
  });
}

import "server-only";
import { renderToBuffer } from "@react-pdf/renderer";
import { prisma } from "@/lib/prisma";
import { ContratDocument, type ParamsContrat } from "@/lib/pdf/contrat";

/**
 * Génère le PDF d'un contrat (buffer + nom de fichier) — partagé entre la route Direction
 * (/employes/[id]/contrat) et l'espace salarié (/espace/contrat). Renvoie null si introuvable.
 */
export async function genererContratPdf(contratId: string): Promise<{ buffer: Buffer; nomFichier: string; employeeId: string } | null> {
  const contrat = await prisma.contrat.findUnique({ where: { id: contratId }, include: { employee: true } });
  if (!contrat) return null;

  // Fonctions décrites dans la fiche de poste (missions principales) → injectées dans l'Article 1.
  const poste = (contrat.poste || contrat.employee.poste).trim();
  const fiche = poste ? await prisma.fichePoste.findFirst({ where: { poste: { equals: poste, mode: "insensitive" } }, select: { descriptionPoste: true } }) : null;

  // Préavis + droits congés depuis les paramètres légaux versionnés (À VALIDER par un comptable).
  const legaux = await prisma.parametreLegal.findMany({
    where: { cle: { in: ["preavis_jours_demission", "preavis_jours_licenciement", "droits_conges_annuel"] } },
    select: { cle: true, valeur: true },
  });
  const val = (cle: string) => {
    const p = legaux.find((x) => x.cle === cle);
    return p ? Number(p.valeur) : null;
  };
  const params: ParamsContrat = {
    preavisDemission: val("preavis_jours_demission"),
    preavisLicenciement: val("preavis_jours_licenciement"),
    droitsCongesAnnuel: val("droits_conges_annuel"),
  };

  const buffer = await renderToBuffer(
    ContratDocument({ employee: contrat.employee, contrat, params, accepteLe: contrat.accepteLe, fonctions: fiche?.descriptionPoste ?? null }),
  );
  const nom = contrat.employee.nom.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "_");
  return { buffer, nomFichier: `Contrat_${contrat.type}_${nom}.pdf`, employeeId: contrat.employeeId };
}

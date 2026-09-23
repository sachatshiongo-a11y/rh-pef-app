import "server-only";
import { renderPdfBuffer } from "@/lib/pdf/fonts";
import { prisma } from "@/lib/prisma";
import { ContratDocument, type ParamsContrat } from "@/lib/pdf/contrat";
import { chargerEntreprise } from "@/lib/entreprise";
import { chargerParametresPaie } from "@/lib/config";
import { reconstituerBrutDepuisNet } from "@/lib/payroll";
import { lireFichier } from "@/lib/storage";
import { formaterNombre } from "@/lib/montant";
import { chargerSignature, signatureImprimable } from "@/lib/signature";

/**
 * Génère le PDF d'un contrat (buffer + nom de fichier) — partagé entre la route Direction
 * (/employes/[id]/contrat) et l'espace salarié (/espace/contrat). Renvoie null si introuvable.
 */
export async function genererContratPdf(
  contratId: string,
  opts?: { ignorerFige?: boolean },
): Promise<{ buffer: Buffer; nomFichier: string; employeeId: string } | null> {
  const contrat = await prisma.contrat.findUnique({ where: { id: contratId }, include: { employee: true } });
  if (!contrat) return null;

  const nomEmp = contrat.employee.nom.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "_");

  // La signature est lue AVANT la décision de servir l'exemplaire figé — elle en fait partie.
  const vue = await chargerSignature(prisma, "CONTRAT", contrat.id);

  // L'EXEMPLAIRE FIGÉ FAIT FOI quand il EST l'exemplaire accepté — jamais une régénération, que le
  // modèle ou la fiche de poste (Article 1) ont pu faire bouger depuis. Trois cas :
  //  - aucun geste tracé : contrat accepté d'un clic avant le 2026-09-22 (signature reprise, sans
  //    tracé), ou exemplaire figé par la Direction sans signature. Rien de plus récent n'existe ;
  //  - signature tracée À JOUR dont l'acceptation EST cette signature (`accepteLe === signeLe`,
  //    posés au même instant par `enregistrerSignature`) : l'exemplaire a été figé APRÈS elle
  //    (`lib/signer-document.ts`, ou « Re-figer »), il porte le tracé. La transaction de signature
  //    retire l'exemplaire précédent : un `pdfAccepteUrl` présent ici ne peut donc pas le précéder ;
  //  - sinon on RÉGÉNÈRE : une signature tracée avant la règle « signer vaut acceptation » (son
  //    exemplaire figé, s'il existe, date d'un clic antérieur et serait muet), ou une signature
  //    OBSOLÈTE — le salarié invité à resigner doit lire les conditions ACTUELLES, avec la mention
  //    « à resigner », et non l'exemplaire de la version qu'il avait signée.
  const figeFaitFoi =
    !vue ||
    vue.traceUrl === null ||
    (!vue.obsolete && contrat.accepteLe !== null && contrat.accepteLe.getTime() === vue.signeLe.getTime());
  if (contrat.pdfAccepteUrl && !opts?.ignorerFige && figeFaitFoi) {
    const fige = await lireFichier(contrat.pdfAccepteUrl);
    if (fige) return { buffer: fige, nomFichier: `Contrat_${contrat.type}_${nomEmp}.pdf`, employeeId: contrat.employeeId };
  }

  // `image` n'est non nul que si la signature est à jour ET porte un tracé (`traceAAfficher`).
  const signatureSalarie = await signatureImprimable(prisma, "CONTRAT", contrat.id);

  // Fonctions décrites dans la fiche de poste (missions principales) → injectées dans l'Article 1.
  const poste = (contrat.poste || contrat.employee.poste).trim();
  const fiche = poste ? await prisma.fichePoste.findFirst({ where: { poste: { equals: poste, mode: "insensitive" } }, select: { descriptionPoste: true } }) : null;

  // Préavis + droits congés depuis les paramètres légaux versionnés (À VALIDER par un comptable).
  const legaux = await prisma.parametreLegal.findMany({
    where: { cle: { in: ["preavis_jours_demission", "preavis_jours_licenciement", "droits_conges_annuel", "salaires_saisis_en_net"] } },
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
  const salaireEstNet = val("salaires_saisis_en_net") === 1;

  // Salaire brut reconstitué (affiché à côté du net sur le contrat, décision client 2026-07-22).
  let salaireBrut: string | null = null;
  if (salaireEstNet) {
    const parametresPaie = await chargerParametresPaie();
    const brut = reconstituerBrutDepuisNet(Number(contrat.salaireMensuel), parametresPaie, contrat.employee.enfants);
    salaireBrut = `${formaterNombre(brut, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${contrat.devise}`;
  }

  const ent = await chargerEntreprise();
  const buffer = await renderPdfBuffer(
    ContratDocument({ employee: contrat.employee, contrat, params, salaireEstNet, salaireBrut, accepteLe: contrat.accepteLe, fonctions: fiche?.descriptionPoste ?? null, entreprise: ent.entreprise, logo: ent.logo, signature: ent.signature, signatureSalarie }),
  );
  return { buffer, nomFichier: `Contrat_${contrat.type}_${nomEmp}.pdf`, employeeId: contrat.employeeId };
}

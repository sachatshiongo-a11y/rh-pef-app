import "server-only";

import { renderPdfBuffer } from "@/lib/pdf/fonts";
import { AttestationDocument } from "@/lib/pdf/attestation";
import { chargerEntreprise } from "@/lib/entreprise";
import { lireFichier } from "@/lib/storage";
import { slugFichier } from "@/lib/texte";
import type { DonneesAttestation } from "@/lib/attestations-donnees";

/** Rend une attestation depuis son instantané (identité, logo et signature des Paramètres). */
export async function rendreAttestationPdf(a: { donnees: DonneesAttestation; numero: string; delivreeLe: Date }): Promise<Buffer> {
  const ent = await chargerEntreprise();
  return renderPdfBuffer(
    AttestationDocument({ donnees: a.donnees, numero: a.numero, delivreeLe: a.delivreeLe, entreprise: ent.entreprise, logo: ent.logo, signature: ent.signature }),
  );
}

/**
 * L'exemplaire d'une attestation DÉLIVRÉE : le PDF figé s'il est lisible, sinon une régénération
 * depuis l'instantané (`donnees`) — jamais depuis la fiche du jour. `null` si l'attestation n'est
 * pas délivrée. Les routes (espace salarié, Direction) ne font que la garde et appellent ceci.
 */
export async function exemplaireAttestation(a: {
  statut: string;
  numero: string | null;
  delivreeLe: Date | null;
  donnees: unknown;
  pdfUrl: string | null;
}): Promise<{ buffer: Buffer; nomFichier: string } | null> {
  if (a.statut !== "DELIVREE" || !a.numero || !a.delivreeLe || !a.donnees) return null;
  const donnees = a.donnees as DonneesAttestation;
  const nomFichier = `${a.numero}_${slugFichier(donnees.nom)}.pdf`;
  const fige = a.pdfUrl ? await lireFichier(a.pdfUrl) : null;
  if (fige) return { buffer: fige, nomFichier };
  return { buffer: await rendreAttestationPdf({ donnees, numero: a.numero, delivreeLe: a.delivreeLe }), nomFichier };
}

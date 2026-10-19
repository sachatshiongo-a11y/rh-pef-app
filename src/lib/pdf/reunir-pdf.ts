/**
 * Réunit plusieurs PDF en un seul, pages bout à bout, dans l'ordre. Sans dépendance au serveur :
 * sert au serveur (rendu par lots, lib/modeles-journaliers) ET au navigateur (document trop long pour
 * une seule requête, récupéré partie par partie : components/telecharger-lien.tsx).
 *
 * Sans flux d'objets : le dictionnaire des polices reste lisible en clair (contrôle des glyphes
 * manquants, lib/test/pdf-lecture).
 */
export async function reunirPdf(parties: Uint8Array[], meta: { titre?: string; auteur?: string } = {}): Promise<Uint8Array> {
  const { PDFDocument } = await import("pdf-lib");
  const reuni = await PDFDocument.create();
  if (meta.titre) reuni.setTitle(meta.titre);
  if (meta.auteur) reuni.setAuthor(meta.auteur);
  for (const octets of parties) {
    const partie = await PDFDocument.load(octets);
    for (const page of await reuni.copyPages(partie, partie.getPageIndices())) reuni.addPage(page);
  }
  return reuni.save({ useObjectStreams: false });
}

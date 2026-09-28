import { prisma } from "@/lib/prisma";
import { chargerSalarie } from "../garde";
import { chargerContratsClasses } from "@/lib/contrats-espace";
import { signerMonDocument } from "../signature-actions";
import { VueMesContrats } from "./vue";

/** « Mes contrats » : à signer, en vigueur, anciens — classement dérivé, jamais écrit en base. */
export default async function EspaceContrats() {
  const s = await chargerSalarie();
  const classes = await chargerContratsClasses(prisma, s.employeeId);
  return (
    <VueMesContrats
      nomSalarie={s.nom}
      action={signerMonDocument}
      lignes={classes.map(({ contrat: c, etat, classement }) => ({
        id: c.id,
        type: c.type,
        poste: c.poste,
        dateDebut: c.dateDebut,
        dateFin: c.dateFin,
        classement,
        etat,
        documentUrl: c.documentUrl,
      }))}
    />
  );
}

-- Passage de 5 à 3 états de bulletin (C2). Migration SANS perte :
-- EN_ATTENTE/PREPARE/ANNULE -> PAS_VALIDE ; VALIDE -> VALIDE ; PAYE -> PAYE.
-- Les colonnes modePaiement / preuveUrl / payeParId sont CONSERVÉES (archivées).

CREATE TYPE "PaymentStatus_new" AS ENUM ('PAS_VALIDE', 'VALIDE', 'PAYE');

-- PayrollLine.statutPaiement
ALTER TABLE "PayrollLine" ALTER COLUMN "statutPaiement" DROP DEFAULT;
ALTER TABLE "PayrollLine" ALTER COLUMN "statutPaiement" TYPE "PaymentStatus_new" USING (
  CASE "statutPaiement"::text
    WHEN 'VALIDE' THEN 'VALIDE'
    WHEN 'PAYE' THEN 'PAYE'
    ELSE 'PAS_VALIDE'
  END::"PaymentStatus_new"
);
ALTER TABLE "PayrollLine" ALTER COLUMN "statutPaiement" SET DEFAULT 'PAS_VALIDE';

-- TransitionPaie.deStatut / versStatut (journal des transitions)
ALTER TABLE "TransitionPaie" ALTER COLUMN "deStatut" TYPE "PaymentStatus_new" USING (
  CASE "deStatut"::text WHEN 'VALIDE' THEN 'VALIDE' WHEN 'PAYE' THEN 'PAYE' ELSE 'PAS_VALIDE' END::"PaymentStatus_new"
);
ALTER TABLE "TransitionPaie" ALTER COLUMN "versStatut" TYPE "PaymentStatus_new" USING (
  CASE "versStatut"::text WHEN 'VALIDE' THEN 'VALIDE' WHEN 'PAYE' THEN 'PAYE' ELSE 'PAS_VALIDE' END::"PaymentStatus_new"
);

DROP TYPE "PaymentStatus";
ALTER TYPE "PaymentStatus_new" RENAME TO "PaymentStatus";

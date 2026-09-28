-- Attestations numérotées (spec 2026-09-28-contrats-attestations-espace, lot 4).
-- Le salarié DEMANDE, la Direction DÉLIVRE (numéro ATT-AAAA-NNNN, exemplaire figé, instantané des
-- valeurs imprimées) ou REFUSE avec un motif. Migration ADDITIVE : deux tables neuves, aucune ligne
-- existante touchée. Les attestations produites avant ce lot n'ont laissé aucune trace en base ;
-- rien n'est reconstitué.
--
-- RLS activée sur les deux tables (ENABLE, sans politique), comme toutes les tables depuis
-- 20260923150000_rls_partout : fermées aux rôles publics de Supabase, l'application (postgres,
-- BYPASSRLS) n'est pas affectée.

-- CreateEnum
CREATE TYPE "public"."TypeAttestation" AS ENUM ('TRAVAIL', 'SALAIRE', 'STAGE');

-- CreateEnum
CREATE TYPE "public"."StatutAttestation" AS ENUM ('DEMANDEE', 'DELIVREE', 'REFUSEE');

-- CreateTable
CREATE TABLE "public"."Attestation" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "type" "public"."TypeAttestation" NOT NULL,
    "statut" "public"."StatutAttestation" NOT NULL DEFAULT 'DEMANDEE',
    "motif" TEXT,
    "motifRefus" TEXT,
    "numero" TEXT,
    "demandeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "demandeParId" TEXT,
    "delivreeLe" TIMESTAMP(3),
    "delivreeParId" TEXT,
    "payrollLineId" TEXT,
    "pdfUrl" TEXT,
    "donnees" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Attestation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
-- Une ligne par année ; incrémentée sous verrou de ligne (INSERT … ON CONFLICT DO UPDATE … RETURNING).
CREATE TABLE "public"."CompteurAttestation" (
    "annee" INTEGER NOT NULL,
    "dernier" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CompteurAttestation_pkey" PRIMARY KEY ("annee")
);

-- CreateIndex
CREATE UNIQUE INDEX "Attestation_numero_key" ON "public"."Attestation"("numero");

-- CreateIndex
CREATE INDEX "Attestation_employeeId_type_statut_idx" ON "public"."Attestation"("employeeId", "type", "statut");

-- CreateIndex
CREATE INDEX "Attestation_statut_idx" ON "public"."Attestation"("statut");

-- AddForeignKey
ALTER TABLE "public"."Attestation" ADD CONSTRAINT "Attestation_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "public"."Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Attestation" ADD CONSTRAINT "Attestation_demandeParId_fkey" FOREIGN KEY ("demandeParId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Attestation" ADD CONSTRAINT "Attestation_delivreeParId_fkey" FOREIGN KEY ("delivreeParId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Attestation" ADD CONSTRAINT "Attestation_payrollLineId_fkey" FOREIGN KEY ("payrollLineId") REFERENCES "public"."PayrollLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RLS (ENABLE, jamais FORCE, aucune politique) — même règle que 20260923150000_rls_partout.
ALTER TABLE "public"."Attestation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."CompteurAttestation" ENABLE ROW LEVEL SECURITY;

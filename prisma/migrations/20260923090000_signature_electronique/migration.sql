-- Signature électronique du salarié : tracé au doigt, horodatage serveur, empreinte des données.
-- Les contrats DÉJÀ acceptés au clic (avant ce lot) sont repris sans tracé — on ne fabrique pas
-- rétroactivement un geste qui n'a pas eu lieu ; le document l'écrira tel quel.

-- CreateEnum
CREATE TYPE "public"."CibleSignature" AS ENUM ('CONTRAT', 'BULLETIN', 'DEMANDE_CONGE');

-- CreateEnum
CREATE TYPE "public"."ModeSignature" AS ENUM ('ESPACE_SALARIE', 'PRESENTIEL');

-- CreateTable
CREATE TABLE "public"."SignatureElectronique" (
    "id" TEXT NOT NULL,
    "cible" "public"."CibleSignature" NOT NULL,
    "cibleId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "traceUrl" TEXT,
    "signeLe" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mode" "public"."ModeSignature" NOT NULL,
    "presenteParId" TEXT,
    "donnees" JSONB NOT NULL,
    "empreinte" TEXT NOT NULL,
    "obsolete" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SignatureElectronique_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SignatureElectronique_cible_cibleId_key" ON "public"."SignatureElectronique"("cible", "cibleId");

-- CreateIndex
CREATE INDEX "SignatureElectronique_employeeId_idx" ON "public"."SignatureElectronique"("employeeId");

-- AddForeignKey
ALTER TABLE "public"."SignatureElectronique" ADD CONSTRAINT "SignatureElectronique_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "public"."Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SignatureElectronique" ADD CONSTRAINT "SignatureElectronique_presenteParId_fkey" FOREIGN KEY ("presenteParId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Reprise des contrats acceptés au clic : signature SANS tracé, à la date d'acceptation.
-- `donnees`/`empreinte` sont laissés vides à dessein : ces contrats n'ont pas été signés sur un
-- instantané, et prétendre le contraire serait faux. L'application traite l'empreinte vide comme
-- « non vérifiable » et n'affiche jamais « modifié après signature » pour eux.
INSERT INTO "public"."SignatureElectronique"
  ("id", "cible", "cibleId", "employeeId", "traceUrl", "signeLe", "mode", "presenteParId", "donnees", "empreinte", "obsolete", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, 'CONTRAT', c."id", c."employeeId", NULL, c."accepteLe", 'ESPACE_SALARIE', NULL, '{}'::jsonb, '', false, NOW(), NOW()
FROM "public"."Contrat" c
WHERE c."accepteLe" IS NOT NULL;

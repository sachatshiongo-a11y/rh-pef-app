-- La migration 20260717040000_param_entreprise avait posé DEFAULT now() sur « updatedAt », que le
-- schéma ne déclare pas (@updatedAt seul) : `prisma migrate diff` le signalait comme seul écart.
-- Aucun effet applicatif : Prisma Client renseigne déjà « updatedAt » à chaque écriture.

-- AlterTable
ALTER TABLE "public"."ParamEntreprise" ALTER COLUMN "updatedAt" DROP DEFAULT;

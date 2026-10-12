-- Réembauche = NOUVELLE FICHE liée à l'ancienne (2026-10-13, décision de Sacha du 12/10 n°10) : une colonne
-- NULLABLE et un index, sur `Employee`. PUREMENT ADDITIF et idempotent : aucune donnée n'est réécrite, le code
-- en production (qui ignore la colonne) continue de fonctionner. La clé étrangère est en SET NULL : supprimer
-- une ancienne fiche ne supprime jamais la nouvelle (le lien disparaît seulement).

-- AlterTable
ALTER TABLE "public"."Employee" ADD COLUMN IF NOT EXISTS "ancienneFicheId" TEXT;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Employee_ancienneFicheId_idx" ON "public"."Employee"("ancienneFicheId");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "public"."Employee" ADD CONSTRAINT "Employee_ancienneFicheId_fkey" FOREIGN KEY ("ancienneFicheId") REFERENCES "public"."Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

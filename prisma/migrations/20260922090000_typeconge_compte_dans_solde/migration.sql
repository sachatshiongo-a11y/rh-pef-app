-- Le solde de congé ne compte que le congé annuel : une case sur le type de congé remplace la
-- reconnaissance par mots-clés (matern/patern/naiss/enfant/maladie/accident) du code.

-- AlterTable
ALTER TABLE "public"."TypeConge" ADD COLUMN "compteDansSolde" BOOLEAN NOT NULL DEFAULT false;

-- Reproduit l'intention d'aujourd'hui sans rien deviner d'autre : le congé annuel se déduit.
-- Si aucun type ne contient « annuel », rien n'est coché — la Direction coche le bon dans Paramètres.
UPDATE "public"."TypeConge" SET "compteDansSolde" = true WHERE lower("nom") LIKE '%annuel%';

-- Onboarding : modèle de checklist + tâches d'intégration par employé.
CREATE TABLE IF NOT EXISTS "public"."ModeleTacheOnboarding" (
  "id" TEXT NOT NULL, "libelle" TEXT NOT NULL, "ordre" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "ModeleTacheOnboarding_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "public"."TacheOnboarding" (
  "id" TEXT NOT NULL, "employeeId" TEXT NOT NULL, "libelle" TEXT NOT NULL,
  "ordre" INTEGER NOT NULL DEFAULT 0, "fait" BOOLEAN NOT NULL DEFAULT false,
  "faitLe" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  CONSTRAINT "TacheOnboarding_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "TacheOnboarding_employeeId_idx" ON "public"."TacheOnboarding"("employeeId");
DO $$ BEGIN
  ALTER TABLE "public"."TacheOnboarding" ADD CONSTRAINT "TacheOnboarding_employeeId_fkey"
    FOREIGN KEY ("employeeId") REFERENCES "public"."Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Modèle par défaut (seedé une seule fois).
INSERT INTO "public"."ModeleTacheOnboarding" ("id", "libelle", "ordre")
SELECT gen_random_uuid()::text, libelle, ordre FROM (VALUES
  ('Signer le contrat de travail', 1),
  ('Remettre le règlement intérieur', 2),
  ('Collecter les pièces (carte d''identité, photo)', 3),
  ('Créer le compte de l''espace salarié', 4),
  ('Inscription à la CNSS', 5),
  ('Visite médicale d''embauche', 6),
  ('Remise de l''uniforme / badge', 7),
  ('Former sur la fiche de poste', 8),
  ('Configurer le pointage', 9)
) AS t(libelle, ordre)
WHERE NOT EXISTS (SELECT 1 FROM "public"."ModeleTacheOnboarding");

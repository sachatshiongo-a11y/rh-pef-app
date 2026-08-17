-- Espace salarié (self-service), désactivé par défaut. Rôle EMPLOYE + toggle + semaines publiées.

-- Nouveau rôle (non utilisé dans cette migration → sûr hors transaction stricte).
ALTER TYPE "public"."Role" ADD VALUE IF NOT EXISTS 'EMPLOYE';

-- Interrupteur global de la fonctionnalité (OFF par défaut : aucun effet tant qu'il n'est pas activé).
ALTER TABLE "public"."Config" ADD COLUMN IF NOT EXISTS "espaceEmployeActif" BOOLEAN NOT NULL DEFAULT false;

-- Forcer le changement du mot de passe temporaire à la 1re connexion d'un compte salarié.
ALTER TABLE "public"."User" ADD COLUMN IF NOT EXISTS "motDePasseTemporaire" BOOLEAN NOT NULL DEFAULT false;

-- Semaines de planning publiées (visibles par les salariés).
CREATE TABLE IF NOT EXISTS "public"."SemainePubliee" (
  "id" TEXT NOT NULL,
  "lundi" DATE NOT NULL,
  "publieeParId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SemainePubliee_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SemainePubliee_lundi_key" ON "public"."SemainePubliee"("lundi");

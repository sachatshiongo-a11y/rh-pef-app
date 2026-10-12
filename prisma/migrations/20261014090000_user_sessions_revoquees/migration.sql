-- Révocation des sessions (audit du 10/10/2026, sécurité 5) : toute session ouverte avant cet instant
-- est refusée par l'application. Colonne facultative, sans valeur par défaut : aucune donnée existante
-- n'est touchée, aucune session actuelle n'est fermée par la migration. Additif et rejouable.
ALTER TABLE "public"."User" ADD COLUMN IF NOT EXISTS "sessionsRevoqueesLe" TIMESTAMP(3);

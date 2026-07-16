-- Cumul salarié + stock, et cloche/notifs personnelles pour les salariés.

-- Un compte salarié (EMPLOYE) peut AUSSI avoir accès à l'espace Stock.
ALTER TABLE "public"."User" ADD COLUMN IF NOT EXISTS "accesStock" BOOLEAN NOT NULL DEFAULT false;

-- Notifications personnelles (cloche du salarié) : domaine SALARIE + destinataire.
ALTER TABLE "public"."Notification" ADD COLUMN IF NOT EXISTS "destinataireUserId" TEXT;
CREATE INDEX IF NOT EXISTS "Notification_destinataireUserId_lu_createdAt_idx"
  ON "public"."Notification"("destinataireUserId", "lu", "createdAt");

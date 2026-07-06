-- Notifications in-app (cloche) pour la Direction.
CREATE TABLE "Notification" (
  "id"        TEXT NOT NULL,
  "type"      TEXT NOT NULL,
  "message"   TEXT NOT NULL,
  "lien"      TEXT,
  "lu"        BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Notification_lu_createdAt_idx" ON "Notification" ("lu", "createdAt");

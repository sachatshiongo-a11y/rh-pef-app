-- DropIndex
DROP INDEX "Notification_lu_createdAt_idx";

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "domaine" TEXT NOT NULL DEFAULT 'RH';

-- CreateIndex
CREATE INDEX "Notification_domaine_lu_createdAt_idx" ON "Notification"("domaine", "lu", "createdAt");


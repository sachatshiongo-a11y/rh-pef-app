-- Référence de la demande source (pour supprimer la notif une fois traitée).
ALTER TABLE "Notification" ADD COLUMN "refId" TEXT;

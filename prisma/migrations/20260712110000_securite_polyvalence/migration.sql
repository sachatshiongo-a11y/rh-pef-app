-- Sécurité connexion (anti-force-brute + réinitialisation de mot de passe) et polyvalence des postes
CREATE TABLE "TentativeConnexion" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TentativeConnexion_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TentativeConnexion_email_createdAt_idx" ON "TentativeConnexion"("email", "createdAt");

CREATE TABLE "JetonReinitialisation" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "JetonReinitialisation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "JetonReinitialisation_tokenHash_key" ON "JetonReinitialisation"("tokenHash");
CREATE INDEX "JetonReinitialisation_email_idx" ON "JetonReinitialisation"("email");

CREATE TABLE "PolyvalencePoste" (
    "id" TEXT NOT NULL,
    "posteSource" TEXT NOT NULL,
    "posteCible" TEXT NOT NULL,
    CONSTRAINT "PolyvalencePoste_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PolyvalencePoste_posteSource_posteCible_key" ON "PolyvalencePoste"("posteSource", "posteCible");

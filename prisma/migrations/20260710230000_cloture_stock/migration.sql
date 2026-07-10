-- Clôture mensuelle du stock : un mois clôturé n'accepte plus de mouvements datés dedans
CREATE TABLE "stock"."ClotureStock" (
    "id" TEXT NOT NULL,
    "annee" INTEGER NOT NULL,
    "mois" INTEGER NOT NULL,
    "creeParId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ClotureStock_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClotureStock_annee_mois_key" ON "stock"."ClotureStock"("annee", "mois");

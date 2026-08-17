-- Commande de légumes frais au restaurant : quantité commandée par légume et par jour.
CREATE TABLE "stock"."CommandeLegumeResto" (
    "id" TEXT NOT NULL,
    "legume" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "quantite" DECIMAL(14,3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CommandeLegumeResto_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CommandeLegumeResto_legume_date_key" ON "stock"."CommandeLegumeResto"("legume", "date");
CREATE INDEX "CommandeLegumeResto_date_idx" ON "stock"."CommandeLegumeResto"("date");

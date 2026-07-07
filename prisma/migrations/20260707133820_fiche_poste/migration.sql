-- Fiche de poste : une par intitulé de poste (description libre + fichier PDF/Word).
CREATE TABLE "FichePoste" (
    "id" TEXT NOT NULL,
    "poste" TEXT NOT NULL,
    "description" TEXT,
    "fichierUrl" TEXT,
    "fichierNom" TEXT,
    "creeParId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FichePoste_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FichePoste_poste_key" ON "FichePoste"("poste");

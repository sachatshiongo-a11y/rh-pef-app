-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "stock";

-- CreateEnum
CREATE TYPE "stock"."DomaineStock" AS ENUM ('NOURRITURE', 'BOISSON');

-- CreateEnum
CREATE TYPE "stock"."TypeMouvementStock" AS ENUM ('ENTREE', 'SORTIE', 'AJUSTEMENT');

-- CreateEnum
CREATE TYPE "stock"."DeviseSaisie" AS ENUM ('USD', 'CDF');

-- CreateEnum
CREATE TYPE "stock"."StatutBonCommande" AS ENUM ('BROUILLON', 'ENVOYE', 'RECU_PARTIEL', 'RECU', 'ANNULE');

-- CreateTable
CREATE TABLE "stock"."Fournisseur" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "produits" TEXT,
    "telephone" TEXT,
    "ville" TEXT,
    "pays" TEXT DEFAULT 'République démocratique du Congo',
    "adresse" TEXT,
    "rccm" TEXT,
    "idNational" TEXT,
    "email" TEXT,
    "contactNom" TEXT,
    "delaiPaiement" TEXT,
    "delaiLivraison" TEXT,
    "modePaiement" TEXT,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Fournisseur_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock"."CategorieStock" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "domaine" "stock"."DomaineStock" NOT NULL,
    "ordre" INTEGER NOT NULL DEFAULT 0,
    "actif" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CategorieStock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock"."ArticleStock" (
    "id" TEXT NOT NULL,
    "code" TEXT,
    "designation" TEXT NOT NULL,
    "domaine" "stock"."DomaineStock" NOT NULL,
    "categorieId" TEXT,
    "unite" TEXT,
    "uniteParCarton" DECIMAL(10,2),
    "fournisseurId" TEXT,
    "prixUnitaireUSD" DECIMAL(12,4),
    "prixCartonUSD" DECIMAL(12,4),
    "prixOrigineCDF" DECIMAL(16,2),
    "tauxImportCDF" DECIMAL(10,2),
    "codeBarres" TEXT,
    "poidsPaquet" DECIMAL(10,3),
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArticleStock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock"."Stock" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "quantite" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "stockMinimum" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "seuilUrgent" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "quantiteEndommagee" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Stock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock"."MouvementStock" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "type" "stock"."TypeMouvementStock" NOT NULL,
    "quantite" DECIMAL(14,3) NOT NULL,
    "date" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "origine" TEXT,
    "devise" "stock"."DeviseSaisie",
    "montantOrigine" DECIMAL(16,2),
    "tauxChangeUtilise" DECIMAL(10,2),
    "montantUSD" DECIMAL(14,4),
    "receptionId" TEXT,
    "creeParId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MouvementStock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock"."BonDeCommande" (
    "id" TEXT NOT NULL,
    "numero" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "annee" INTEGER NOT NULL,
    "mois" INTEGER NOT NULL,
    "date" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fournisseurId" TEXT,
    "statut" "stock"."StatutBonCommande" NOT NULL DEFAULT 'BROUILLON',
    "delaiPaiement" TEXT,
    "modePaiement" TEXT,
    "totalUSD" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "totalCDF" DECIMAL(16,2),
    "tauxChangeUtilise" DECIMAL(10,2),
    "commentaire" TEXT,
    "creeParId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BonDeCommande_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock"."LigneBonDeCommande" (
    "id" TEXT NOT NULL,
    "bonDeCommandeId" TEXT NOT NULL,
    "articleId" TEXT,
    "designation" TEXT NOT NULL,
    "unite" TEXT,
    "uniteParCarton" DECIMAL(10,2),
    "nbCartons" DECIMAL(10,2),
    "quantite" DECIMAL(14,3) NOT NULL,
    "prixUnitaireUSD" DECIMAL(12,4) NOT NULL,
    "totalLigneUSD" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "LigneBonDeCommande_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock"."Reception" (
    "id" TEXT NOT NULL,
    "bonDeCommandeId" TEXT,
    "date" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "commentaire" TEXT,
    "creeParId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reception_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock"."ParametresAchat" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "acheteurNom" TEXT NOT NULL DEFAULT 'TOLYA SARL',
    "acheteurAdresse" TEXT,
    "acheteurVille" TEXT,
    "acheteurPays" TEXT,
    "acheteurIdNational" TEXT,
    "acheteurRccm" TEXT,
    "acheteurTelephone" TEXT,
    "acheteurContact" TEXT,

    CONSTRAINT "ParametresAchat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CategorieStock_domaine_nom_key" ON "stock"."CategorieStock"("domaine", "nom");

-- CreateIndex
CREATE UNIQUE INDEX "Stock_articleId_key" ON "stock"."Stock"("articleId");

-- CreateIndex
CREATE INDEX "MouvementStock_articleId_date_idx" ON "stock"."MouvementStock"("articleId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "BonDeCommande_numero_key" ON "stock"."BonDeCommande"("numero");

-- CreateIndex
CREATE INDEX "BonDeCommande_annee_mois_idx" ON "stock"."BonDeCommande"("annee", "mois");

-- AddForeignKey
ALTER TABLE "stock"."ArticleStock" ADD CONSTRAINT "ArticleStock_categorieId_fkey" FOREIGN KEY ("categorieId") REFERENCES "stock"."CategorieStock"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock"."ArticleStock" ADD CONSTRAINT "ArticleStock_fournisseurId_fkey" FOREIGN KEY ("fournisseurId") REFERENCES "stock"."Fournisseur"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock"."Stock" ADD CONSTRAINT "Stock_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "stock"."ArticleStock"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock"."MouvementStock" ADD CONSTRAINT "MouvementStock_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "stock"."ArticleStock"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock"."MouvementStock" ADD CONSTRAINT "MouvementStock_receptionId_fkey" FOREIGN KEY ("receptionId") REFERENCES "stock"."Reception"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock"."BonDeCommande" ADD CONSTRAINT "BonDeCommande_fournisseurId_fkey" FOREIGN KEY ("fournisseurId") REFERENCES "stock"."Fournisseur"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock"."LigneBonDeCommande" ADD CONSTRAINT "LigneBonDeCommande_bonDeCommandeId_fkey" FOREIGN KEY ("bonDeCommandeId") REFERENCES "stock"."BonDeCommande"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock"."LigneBonDeCommande" ADD CONSTRAINT "LigneBonDeCommande_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "stock"."ArticleStock"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock"."Reception" ADD CONSTRAINT "Reception_bonDeCommandeId_fkey" FOREIGN KEY ("bonDeCommandeId") REFERENCES "stock"."BonDeCommande"("id") ON DELETE SET NULL ON UPDATE CASCADE;


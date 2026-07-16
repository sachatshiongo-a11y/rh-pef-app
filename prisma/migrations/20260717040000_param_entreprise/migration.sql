-- Identité de l'entreprise éditable dans Paramètres (singleton).
CREATE TABLE IF NOT EXISTS "public"."ParamEntreprise" (
  "id" TEXT NOT NULL DEFAULT 'singleton',
  "nom" TEXT, "enseigne" TEXT, "telephone" TEXT, "email" TEXT, "site" TEXT,
  "adresse" TEXT, "lieuTravail" TEXT, "pays" TEXT, "compteBancaire" TEXT,
  "rccm" TEXT, "idNat" TEXT, "numImpot" TEXT,
  "logoUrl" TEXT, "logoNom" TEXT, "signatureUrl" TEXT, "signatureNom" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  CONSTRAINT "ParamEntreprise_pkey" PRIMARY KEY ("id")
);

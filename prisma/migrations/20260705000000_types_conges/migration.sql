-- Types de congés paramétrables (§6). Nouveaux types avec jours payés/taux « À VALIDER » (null).
CREATE TABLE "TypeConge" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "joursPayes" INTEGER,
    "tauxPct" INTEGER,
    "ordre" INTEGER NOT NULL DEFAULT 0,
    "systeme" BOOLEAN NOT NULL DEFAULT false,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "TypeConge_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TypeConge_nom_key" ON "TypeConge"("nom");

-- Types existants + nouveaux (§6). Les valeurs null = À VALIDER par un comptable-juriste.
INSERT INTO "TypeConge" ("id","nom","joursPayes","tauxPct","ordre","systeme","actif") VALUES
 ('tc_annuel','Congé annuel',NULL,100,1,true,true),
 ('tc_maladie','Congé maladie',NULL,NULL,2,true,true),
 ('tc_maternite','Congé maternité',NULL,NULL,3,true,true),
 ('tc_mal_pro','Maladie professionnelle',NULL,NULL,4,false,true),
 ('tc_accident','Accident du travail',NULL,NULL,5,false,true),
 ('tc_sans_solde','Congé sans solde',0,0,6,false,true),
 ('tc_naissance','Naissance (arrivée d''un enfant)',NULL,NULL,7,false,true),
 ('tc_mariage','Mariage',NULL,NULL,8,false,true),
 ('tc_deces','Décès d''un proche',NULL,NULL,9,false,true),
 ('tc_autre','Autre',NULL,NULL,10,true,true);

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'MANAGER', 'VIEWER');

-- CreateEnum
CREATE TYPE "EmployeeCategory" AS ENUM ('BRIGADE', 'BACKOFFICE');

-- CreateEnum
CREATE TYPE "EmployeeType" AS ENUM ('NATIONAL', 'EXPATRIE');

-- CreateEnum
CREATE TYPE "AttendanceCode" AS ENUM ('P', 'O', 'M', 'A', 'N', 'C', 'F');

-- CreateEnum
CREATE TYPE "PayrollStatus" AS ENUM ('BROUILLON', 'VALIDE');

-- CreateEnum
CREATE TYPE "LeaveStatus" AS ENUM ('EN_ATTENTE', 'APPROUVE', 'REFUSE');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('EN_ATTENTE', 'PAYE');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'VIEWER',
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Config" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "tauxChangeCDF" DECIMAL(10,2) NOT NULL,
    "anneeCourante" INTEGER NOT NULL,
    "moisCourant" INTEGER NOT NULL,
    "joursOuvrablesMois" INTEGER NOT NULL DEFAULT 26,
    "droitsCongesAnnuel" DECIMAL(5,2) NOT NULL DEFAULT 18,
    "cnssTauxSalarie" DECIMAL(5,4) NOT NULL DEFAULT 0.05,
    "cnssTauxPatronal" DECIMAL(5,4) NOT NULL DEFAULT 0.09,
    "allocFamilialeParEnfant" DECIMAL(10,2) NOT NULL DEFAULT 1.5,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IprTranche" (
    "id" SERIAL NOT NULL,
    "ordre" INTEGER NOT NULL,
    "plafond" DECIMAL(12,2),
    "taux" DECIMAL(5,4) NOT NULL,

    CONSTRAINT "IprTranche_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JourFerie" (
    "id" SERIAL NOT NULL,
    "date" DATE NOT NULL,
    "designation" TEXT NOT NULL,
    "annee" INTEGER NOT NULL,

    CONSTRAINT "JourFerie_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "matricule" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "sexe" TEXT NOT NULL,
    "etatCivil" TEXT NOT NULL,
    "poste" TEXT NOT NULL,
    "secteur" TEXT NOT NULL,
    "categorie" "EmployeeCategory" NOT NULL,
    "salaireMensuel" DECIMAL(12,2) NOT NULL,
    "transportJourCDF" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "transportMoisCDF" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "transportMoisUSD" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "cnssMontant" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "enfants" INTEGER NOT NULL DEFAULT 0,
    "type" "EmployeeType" NOT NULL DEFAULT 'NATIONAL',
    "dateEmbauche" DATE NOT NULL,
    "contrat" TEXT NOT NULL,
    "heuresParJour" DECIMAL(5,2) NOT NULL DEFAULT 8,
    "actif" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attendance" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "code" "AttendanceCode" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OvertimeEntry" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "heuresTravaillees" DECIMAL(5,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OvertimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollRun" (
    "id" TEXT NOT NULL,
    "mois" INTEGER NOT NULL,
    "annee" INTEGER NOT NULL,
    "statut" "PayrollStatus" NOT NULL DEFAULT 'BROUILLON',
    "dateCalcul" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tauxChangeUtilise" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "PayrollRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollLine" (
    "id" TEXT NOT NULL,
    "payrollRunId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "joursPayes100" INTEGER NOT NULL DEFAULT 0,
    "joursPayes2_3" INTEGER NOT NULL DEFAULT 0,
    "joursNonPayes" INTEGER NOT NULL DEFAULT 0,
    "remuneration100" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "remuneration2_3" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "hsValorisee" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "transportUSD" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "salBrutUSD" DECIMAL(12,2) NOT NULL,
    "cnssSalarieUSD" DECIMAL(12,2) NOT NULL,
    "netImposableUSD" DECIMAL(12,2) NOT NULL,
    "iprCalculeUSD" DECIMAL(12,2) NOT NULL,
    "allocFamilialeUSD" DECIMAL(12,2) NOT NULL,
    "salNetUSD" DECIMAL(12,2) NOT NULL,
    "salNetCDF" DECIMAL(14,2) NOT NULL,
    "cnssPatronalUSD" DECIMAL(12,2) NOT NULL,
    "coutEmployeurUSD" DECIMAL(12,2) NOT NULL,
    "coutEmployeurCDF" DECIMAL(14,2) NOT NULL,
    "statutPaiement" "PaymentStatus" NOT NULL DEFAULT 'EN_ATTENTE',
    "datePaiement" TIMESTAMP(3),
    "payeParId" TEXT,

    CONSTRAINT "PayrollLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveRequest" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "dateDebut" DATE NOT NULL,
    "dateFin" DATE NOT NULL,
    "nbJours" DECIMAL(5,2) NOT NULL,
    "statut" "LeaveStatus" NOT NULL DEFAULT 'EN_ATTENTE',
    "approuveParId" TEXT,
    "dateEnreg" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaveRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "IprTranche_ordre_key" ON "IprTranche"("ordre");

-- CreateIndex
CREATE UNIQUE INDEX "JourFerie_date_key" ON "JourFerie"("date");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_matricule_key" ON "Employee"("matricule");

-- CreateIndex
CREATE INDEX "Attendance_date_idx" ON "Attendance"("date");

-- CreateIndex
CREATE UNIQUE INDEX "Attendance_employeeId_date_key" ON "Attendance"("employeeId", "date");

-- CreateIndex
CREATE INDEX "OvertimeEntry_date_idx" ON "OvertimeEntry"("date");

-- CreateIndex
CREATE UNIQUE INDEX "OvertimeEntry_employeeId_date_key" ON "OvertimeEntry"("employeeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRun_mois_annee_key" ON "PayrollRun"("mois", "annee");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollLine_payrollRunId_employeeId_key" ON "PayrollLine"("payrollRunId", "employeeId");

-- CreateIndex
CREATE INDEX "LeaveRequest_employeeId_idx" ON "LeaveRequest"("employeeId");

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OvertimeEntry" ADD CONSTRAINT "OvertimeEntry_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollLine" ADD CONSTRAINT "PayrollLine_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "PayrollRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollLine" ADD CONSTRAINT "PayrollLine_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollLine" ADD CONSTRAINT "PayrollLine_payeParId_fkey" FOREIGN KEY ("payeParId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_approuveParId_fkey" FOREIGN KEY ("approuveParId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

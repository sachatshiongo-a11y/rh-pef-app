-- AlterEnum
ALTER TYPE "AttendanceCode" ADD VALUE 'S';

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "heuresHebdomadaires" DECIMAL(5,2) NOT NULL DEFAULT 48;

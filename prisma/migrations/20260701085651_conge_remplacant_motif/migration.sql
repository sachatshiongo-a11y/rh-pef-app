-- AlterTable
ALTER TABLE "LeaveRequest" ADD COLUMN     "motif" TEXT,
ADD COLUMN     "remplacantId" TEXT;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_remplacantId_fkey" FOREIGN KEY ("remplacantId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

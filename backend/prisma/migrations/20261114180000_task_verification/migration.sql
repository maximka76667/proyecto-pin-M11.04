-- AlterEnum
ALTER TYPE "AssignmentStatus" ADD VALUE 'waiting_verification';

-- AlterTable
ALTER TABLE "TaskAssignment" ADD COLUMN     "rejection_reason" TEXT,
ADD COLUMN     "verification_deadline" TIMESTAMP(3),
ADD COLUMN     "verifier_id" UUID;

-- CreateIndex
CREATE INDEX "TaskAssignment_verifier_id_idx" ON "TaskAssignment"("verifier_id");

-- AddForeignKey
ALTER TABLE "TaskAssignment" ADD CONSTRAINT "TaskAssignment_verifier_id_fkey" FOREIGN KEY ("verifier_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

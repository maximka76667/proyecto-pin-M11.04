-- DropIndex
DROP INDEX "TaskSwapRequest_from_assignment_id_key";

-- CreateEnum
CREATE TYPE "SwapStatus" AS ENUM ('pending', 'completed');

-- AlterTable
ALTER TABLE "TaskSwapRequest"
    ADD COLUMN "status" "SwapStatus" NOT NULL DEFAULT 'pending',
    ADD COLUMN "resolved_at" TIMESTAMP(3);

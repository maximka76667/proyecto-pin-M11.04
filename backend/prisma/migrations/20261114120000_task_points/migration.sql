-- AlterTable
ALTER TABLE "Task" ADD COLUMN "points" INTEGER NOT NULL DEFAULT 0;

-- Relleno de las tareas existentes: duración x factor de prioridad
UPDATE "Task"
SET "points" = ROUND("duration_minutes" * CASE "priority"
  WHEN 'low' THEN 1
  WHEN 'medium' THEN 1.5
  WHEN 'high' THEN 2
END);

-- CreateTable
CREATE TABLE "TaskPoints" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "apartment_id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "points" INTEGER NOT NULL,
    "month" VARCHAR(7) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskPoints_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TaskPoints_assignment_id_key" ON "TaskPoints"("assignment_id");

-- CreateIndex
CREATE INDEX "TaskPoints_apartment_id_month_idx" ON "TaskPoints"("apartment_id", "month");

-- CreateIndex
CREATE INDEX "TaskPoints_user_id_month_idx" ON "TaskPoints"("user_id", "month");

-- AddForeignKey
ALTER TABLE "TaskPoints" ADD CONSTRAINT "TaskPoints_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskPoints" ADD CONSTRAINT "TaskPoints_apartment_id_fkey" FOREIGN KEY ("apartment_id") REFERENCES "Apartment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskPoints" ADD CONSTRAINT "TaskPoints_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "TaskAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

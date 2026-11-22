-- CreateEnum
CREATE TYPE "TaskPreferenceType" AS ENUM ('prefer', 'indifferent', 'avoid');

-- CreateTable
CREATE TABLE "TaskPreference" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "preference" "TaskPreferenceType" NOT NULL DEFAULT 'indifferent',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskPreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TaskPreference_user_id_task_id_key" ON "TaskPreference"("user_id", "task_id");

-- CreateIndex
CREATE INDEX "TaskPreference_user_id_idx" ON "TaskPreference"("user_id");

-- CreateIndex
CREATE INDEX "TaskPreference_task_id_idx" ON "TaskPreference"("task_id");

-- AddForeignKey
ALTER TABLE "TaskPreference" ADD CONSTRAINT "TaskPreference_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskPreference" ADD CONSTRAINT "TaskPreference_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

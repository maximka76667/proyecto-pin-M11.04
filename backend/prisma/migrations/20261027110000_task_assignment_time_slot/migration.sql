ALTER TABLE "TaskAssignment"
ADD COLUMN "due_time" VARCHAR(5);

CREATE UNIQUE INDEX "TaskAssignment_user_id_due_date_due_time_key"
ON "TaskAssignment"("user_id", "due_date", "due_time");

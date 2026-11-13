-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('task_assigned', 'task_due_soon', 'swap_requested', 'swap_accepted', 'swap_rejected');

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "apartment_id" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "reference_id" UUID,
    "assignment_id" UUID,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_user_id_apartment_id_created_at_idx" ON "Notification"("user_id", "apartment_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_user_id_type_assignment_id_key" ON "Notification"("user_id", "type", "assignment_id");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_apartment_id_fkey" FOREIGN KEY ("apartment_id") REFERENCES "Apartment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "TaskAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

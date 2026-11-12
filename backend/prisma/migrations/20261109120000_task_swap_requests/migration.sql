-- CreateTable
CREATE TABLE "TaskSwapRequest" (
    "id" UUID NOT NULL,
    "apartment_id" UUID NOT NULL,
    "from_user_id" UUID NOT NULL,
    "to_user_id" UUID NOT NULL,
    "from_assignment_id" UUID NOT NULL,
    "to_assignment_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskSwapRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TaskSwapRequest_from_assignment_id_key" ON "TaskSwapRequest"("from_assignment_id");

-- CreateIndex
CREATE INDEX "TaskSwapRequest_to_user_id_idx" ON "TaskSwapRequest"("to_user_id");

-- CreateIndex
CREATE INDEX "TaskSwapRequest_from_user_id_idx" ON "TaskSwapRequest"("from_user_id");

-- CreateIndex
CREATE INDEX "TaskSwapRequest_apartment_id_idx" ON "TaskSwapRequest"("apartment_id");

-- AddForeignKey
ALTER TABLE "TaskSwapRequest" ADD CONSTRAINT "TaskSwapRequest_apartment_id_fkey" FOREIGN KEY ("apartment_id") REFERENCES "Apartment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskSwapRequest" ADD CONSTRAINT "TaskSwapRequest_from_user_id_fkey" FOREIGN KEY ("from_user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskSwapRequest" ADD CONSTRAINT "TaskSwapRequest_to_user_id_fkey" FOREIGN KEY ("to_user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskSwapRequest" ADD CONSTRAINT "TaskSwapRequest_from_assignment_id_fkey" FOREIGN KEY ("from_assignment_id") REFERENCES "TaskAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskSwapRequest" ADD CONSTRAINT "TaskSwapRequest_to_assignment_id_fkey" FOREIGN KEY ("to_assignment_id") REFERENCES "TaskAssignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

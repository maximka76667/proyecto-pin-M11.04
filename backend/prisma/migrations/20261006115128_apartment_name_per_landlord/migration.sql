/*
  Warnings:

  - A unique constraint covering the columns `[landlord_id,name]` on the table `Apartment` will be added. If there are existing duplicate values, this will fail.
  - Existing apartments will receive a temporary name based on their id before the column becomes required.

*/
-- DropForeignKey
ALTER TABLE "UserApartment" DROP CONSTRAINT "UserApartment_apartment_id_fkey";

-- DropForeignKey
ALTER TABLE "UserApartment" DROP CONSTRAINT "UserApartment_user_id_fkey";

-- AlterTable
ALTER TABLE "Apartment" ADD COLUMN     "name" TEXT;

-- Populate existing apartments before making the column required.
UPDATE "Apartment"
SET "name" = 'Apartment-' || "id"::text
WHERE "name" IS NULL;

ALTER TABLE "Apartment" ALTER COLUMN "name" SET NOT NULL;

-- CreateIndex
CREATE INDEX "Apartment_landlord_id_idx" ON "Apartment"("landlord_id");

-- CreateIndex
CREATE UNIQUE INDEX "Apartment_landlord_id_name_key" ON "Apartment"("landlord_id", "name");

-- CreateIndex
CREATE INDEX "UserApartment_apartment_id_idx" ON "UserApartment"("apartment_id");

-- AddForeignKey
ALTER TABLE "UserApartment" ADD CONSTRAINT "UserApartment_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserApartment" ADD CONSTRAINT "UserApartment_apartment_id_fkey" FOREIGN KEY ("apartment_id") REFERENCES "Apartment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

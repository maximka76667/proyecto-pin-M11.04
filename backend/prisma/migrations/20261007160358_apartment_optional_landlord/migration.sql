-- DropForeignKey
ALTER TABLE "Apartment" DROP CONSTRAINT "Apartment_landlord_id_fkey";

-- AlterTable
ALTER TABLE "Apartment" ALTER COLUMN "landlord_id" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Apartment" ADD CONSTRAINT "Apartment_landlord_id_fkey" FOREIGN KEY ("landlord_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

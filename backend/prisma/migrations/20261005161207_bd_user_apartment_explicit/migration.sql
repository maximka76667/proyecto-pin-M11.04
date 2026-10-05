/*
  Warnings:

  - You are about to drop the `_UserApartments` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "_UserApartments" DROP CONSTRAINT "_UserApartments_A_fkey";

-- DropForeignKey
ALTER TABLE "_UserApartments" DROP CONSTRAINT "_UserApartments_B_fkey";

-- DropTable
DROP TABLE "_UserApartments";

-- CreateTable
CREATE TABLE "UserApartment" (
    "user_id" UUID NOT NULL,
    "apartment_id" UUID NOT NULL,

    CONSTRAINT "UserApartment_pkey" PRIMARY KEY ("user_id","apartment_id")
);

-- AddForeignKey
ALTER TABLE "UserApartment" ADD CONSTRAINT "UserApartment_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserApartment" ADD CONSTRAINT "UserApartment_apartment_id_fkey" FOREIGN KEY ("apartment_id") REFERENCES "Apartment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

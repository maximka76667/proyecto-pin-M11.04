-- CreateEnum
CREATE TYPE "DocumentKind" AS ENUM ('file', 'link');

-- CreateTable
CREATE TABLE "ApartmentDocument" (
    "id" UUID NOT NULL,
    "apartment_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "kind" "DocumentKind" NOT NULL,
    "storage_path" TEXT,
    "mime_type" TEXT,
    "size_bytes" INTEGER,
    "original_filename" TEXT,
    "url" TEXT,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApartmentDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApartmentDocument_apartment_id_created_at_idx" ON "ApartmentDocument"("apartment_id", "created_at");

-- AddForeignKey
ALTER TABLE "ApartmentDocument" ADD CONSTRAINT "ApartmentDocument_apartment_id_fkey" FOREIGN KEY ("apartment_id") REFERENCES "Apartment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApartmentDocument" ADD CONSTRAINT "ApartmentDocument_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApartmentDocument" ADD CONSTRAINT "ApartmentDocument_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

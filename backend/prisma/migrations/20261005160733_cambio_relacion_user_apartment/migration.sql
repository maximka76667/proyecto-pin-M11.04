-- CreateTable
CREATE TABLE "_UserApartments" (
    "A" UUID NOT NULL,
    "B" UUID NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "_UserApartments_AB_unique" ON "_UserApartments"("A", "B");

-- CreateIndex
CREATE INDEX "_UserApartments_B_index" ON "_UserApartments"("B");

-- AddForeignKey
ALTER TABLE "_UserApartments" ADD CONSTRAINT "_UserApartments_A_fkey" FOREIGN KEY ("A") REFERENCES "Apartment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_UserApartments" ADD CONSTRAINT "_UserApartments_B_fkey" FOREIGN KEY ("B") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

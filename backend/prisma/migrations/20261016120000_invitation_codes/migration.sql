-- Invitation codes identify apartments and are generated automatically for new homes.
ALTER TABLE "User" ALTER COLUMN "email" DROP NOT NULL;

ALTER TABLE "Apartment" ADD COLUMN "invite_code" UUID;
UPDATE "Apartment" SET "invite_code" = gen_random_uuid();
ALTER TABLE "Apartment" ALTER COLUMN "invite_code" SET NOT NULL;
CREATE UNIQUE INDEX "Apartment_invite_code_key" ON "Apartment"("invite_code");

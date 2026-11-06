ALTER TABLE "User"
ADD COLUMN "password_hash" TEXT,
ADD COLUMN "google_subject" TEXT;

CREATE UNIQUE INDEX "User_google_subject_key" ON "User"("google_subject");

CREATE TABLE "AuthSession" (
    "id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AuthSession_token_hash_key" ON "AuthSession"("token_hash");
CREATE INDEX "AuthSession_user_id_idx" ON "AuthSession"("user_id");
CREATE INDEX "AuthSession_expires_at_idx" ON "AuthSession"("expires_at");
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Notificaciones push: el token de Expo de cada móvil donde el usuario ha iniciado sesión.
-- Generado con `prisma migrate diff` y aplicado con `prisma migrate deploy` (nunca
-- `migrate dev`: la base de Supabase es compartida por el equipo).

-- CreateTable
CREATE TABLE "PushToken" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PushToken_token_key" ON "PushToken"("token");

-- CreateIndex
CREATE INDEX "PushToken_user_id_idx" ON "PushToken"("user_id");

-- AddForeignKey
ALTER TABLE "PushToken" ADD CONSTRAINT "PushToken_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

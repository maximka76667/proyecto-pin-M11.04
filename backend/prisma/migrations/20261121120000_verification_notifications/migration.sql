-- UT1021: avisos de la verificación de tareas en la misma tabla que los demás.
-- Solo se añaden valores al enum; ninguno se usa en esta migración, así que puede ir dentro de
-- la transacción de `prisma migrate deploy`.

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'verification_requested';
ALTER TYPE "NotificationType" ADD VALUE 'verification_approved';
ALTER TYPE "NotificationType" ADD VALUE 'verification_rejected';

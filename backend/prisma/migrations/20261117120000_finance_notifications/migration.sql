-- UT1018: avisos de los gastos del piso en la misma tabla que los de las tareas (UT1019).
-- Solo se añaden valores al enum; ninguno se usa en esta migración, así que puede ir dentro de
-- la transacción de `prisma migrate deploy`.

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'expense_added';
ALTER TYPE "NotificationType" ADD VALUE 'expense_updated';
ALTER TYPE "NotificationType" ADD VALUE 'expense_deleted';
ALTER TYPE "NotificationType" ADD VALUE 'payment_marked';
ALTER TYPE "NotificationType" ADD VALUE 'payment_confirmed';
ALTER TYPE "NotificationType" ADD VALUE 'payment_rejected';

-- Nueva categoría para las transacciones pendientes.
ALTER TYPE "TransactionCategory" ADD VALUE 'pending';

-- created_at: cuándo se registró en la app. date: cuándo ocurrió el gasto.
-- Las transacciones que ya existen se quedan con la fecha de la migración,
-- porque no hay forma de saber su fecha real.
ALTER TABLE "Transaction" ADD COLUMN "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Transaction" ADD COLUMN "date" DATE NOT NULL DEFAULT CURRENT_DATE;

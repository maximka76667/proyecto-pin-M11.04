CREATE TYPE "ExpenseType" AS ENUM ('EXPENSE', 'SETTLEMENT');

CREATE TABLE "Receipt" (
    "id" UUID NOT NULL,
    "apartment_id" UUID NOT NULL,
    "payer_id" UUID NOT NULL,
    "total_amount" DECIMAL(12,2) NOT NULL,
    "date" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Expense" (
    "id" UUID NOT NULL,
    "apartment_id" UUID NOT NULL,
    "payer_id" UUID NOT NULL,
    "receipt_id" UUID,
    "type" "ExpenseType" NOT NULL DEFAULT 'EXPENSE',
    "total_amount" DECIMAL(12,2) NOT NULL,
    "concept" TEXT,
    "category" "TransactionCategory" NOT NULL,
    "date" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payer_participates" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Receipt_apartment_id_date_idx" ON "Receipt"("apartment_id", "date");
CREATE INDEX "Receipt_payer_id_idx" ON "Receipt"("payer_id");
CREATE INDEX "Expense_apartment_id_date_idx" ON "Expense"("apartment_id", "date");
CREATE INDEX "Expense_payer_id_idx" ON "Expense"("payer_id");
CREATE INDEX "Expense_receipt_id_idx" ON "Expense"("receipt_id");

ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_apartment_id_fkey" FOREIGN KEY ("apartment_id") REFERENCES "Apartment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_payer_id_fkey" FOREIGN KEY ("payer_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_apartment_id_fkey" FOREIGN KEY ("apartment_id") REFERENCES "Apartment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_payer_id_fkey" FOREIGN KEY ("payer_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "Receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Nullable por ahora: las transacciones existentes no tienen gasto. Una migración posterior
-- borrará los datos antiguos y la hará NOT NULL.
ALTER TABLE "Transaction" ADD COLUMN "expense_id" UUID;

CREATE INDEX "Transaction_expense_id_idx" ON "Transaction"("expense_id");

ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "Expense"("id") ON DELETE CASCADE ON UPDATE CASCADE;

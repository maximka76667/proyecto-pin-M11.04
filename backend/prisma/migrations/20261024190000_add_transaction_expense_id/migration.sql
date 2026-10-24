ALTER TABLE "Transaction" ADD COLUMN "expense_id" UUID;

CREATE INDEX "Transaction_expense_id_idx" ON "Transaction"("expense_id");

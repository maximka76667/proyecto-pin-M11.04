DROP INDEX IF EXISTS "Transaction_expense_id_idx";
ALTER TABLE "Transaction"
  DROP COLUMN IF EXISTS "expense_id",
  DROP COLUMN IF EXISTS "total_amount";

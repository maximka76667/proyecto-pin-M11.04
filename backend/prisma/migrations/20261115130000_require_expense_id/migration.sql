-- Limpieza de datos: las transacciones anteriores a los gastos no tienen expense_id y ya no
-- se usan (la app lista, edita y borra a través de los gastos). Solo se borran estas filas:
-- usuarios, pisos, tareas, tickets y gastos no se tocan.
DELETE FROM "Transaction" WHERE "expense_id" IS NULL;

-- Desde ahora cada deuda pertenece a un gasto
ALTER TABLE "Transaction" ALTER COLUMN "expense_id" SET NOT NULL;

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// La app calcula la vista previa del reparto con su propia copia de expense-split.ts. Si las
// dos copias se separan, la app enseñaría un importe y el servidor cobraría otro.
describe('expense-split.ts: copia en la app', () => {
  const leer = (ruta: string) =>
    readFileSync(join(__dirname, ruta), 'utf8').replace(/\r\n/g, '\n');

  it('es idéntica a la del servidor', () => {
    expect(leer('../../../frontend/src/lib/expense-split.ts')).toBe(
      leer('./expense-split.ts'),
    );
  });
});

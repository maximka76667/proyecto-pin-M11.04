import {
  ANA,
  JUAN,
  LUIS,
  PISO,
  db,
  deTipo,
  exito,
  prepararObservador,
  texto,
} from '../../test/observador';
import {
  GASTO_BORRADO,
  GASTO_CREADO,
  GASTO_EDITADO,
  GastoBorrado,
  GastoCreado,
  GastoEditado,
  PAGO_CONFIRMADO,
  PAGO_MARCADO,
  PAGO_RECHAZADO,
  PagoConfirmado,
  PagoMarcado,
  PagoRechazado,
  TICKET_BORRADO,
  TICKET_CREADO,
  TicketBorrado,
  TicketCreado,
} from '../transactions/expense.events';

// Patrón Observer · los sujetos de gastos y pagos (UT1018). Por HTTP, con TransactionsService y
// ExpensesService reales: cada acción emite su evento una sola vez, con sus datos, solo cuando
// se ha guardado, y los avisos que crea el observador ya están en la base de datos al responder

describe('Patrón Observer · gastos, tickets y pagos (los sujetos)', () => {
  const { como, emitidos, nombresEmitidos } = prepararObservador();

  // Juan paga 30 € de cena y la reparte entre él, Ana y Luis: cada uno le debe 10 €
  async function cena() {
    exito(
      await como(JUAN).post('/transactions', {
        apartment_id: PISO,
        from_user_id: JUAN,
        to_user_ids: [JUAN, ANA, LUIS],
        amount: '30',
        concept: 'Cena del viernes',
        category: 'supplies',
      }),
    );
    const gasto = db.filasDe('Expense').find((fila) => fila.concept === 'Cena del viernes')!;
    return { id: gasto.id as string, version: gasto.version as number };
  }

  // Ticket de 6 € con dos productos repartidos entre los tres: 2 € cada uno
  async function ticket() {
    const respuesta = await como(JUAN).post('/transactions/from-receipt', {
      apartment_id: PISO,
      participant_ids: [JUAN, ANA, LUIS],
      items: [
        { name: 'Leche', unit_price: '1.50', quantity: 2 },
        { name: 'Pan', unit_price: '3.00', quantity: 1 },
      ],
      category: 'supplies',
    });
    exito(respuesta);
    return (respuesta.body as { receipt_id: string }).receipt_id;
  }

  const ultimo = () => emitidos().at(-1)!;

  describe('crear', () => {
    it('un gasto emite GASTO_CREADO una vez, con una deuda por deudor y quién lo crea', async () => {
      await cena();

      expect(nombresEmitidos()).toEqual([GASTO_CREADO]);
      const evento = ultimo()[1] as GastoCreado;
      expect(evento).toBeInstanceOf(GastoCreado);
      expect(evento.actorId).toBe(JUAN);
      expect(evento.deudas.map((deuda) => [deuda.to_user_id, deuda.amount])).toEqual([
        [ANA, '10.00'],
        [LUIS, '10.00'],
      ]);
    });

    it('al responder, Ana y Luis ya tienen su «Aviso de cobro» y Juan ninguno', async () => {
      await cena();

      expect(texto(deTipo(ANA, 'expense_added')[0])).toBe('Juan Pérez solicita 10,00 € por «Cena del viernes».');
      expect(deTipo(LUIS, 'expense_added')).toHaveLength(1);
      expect(deTipo(JUAN, 'expense_added')).toHaveLength(0);
    });

    it('un ticket de dos productos emite un solo TICKET_CREADO con las deudas de los dos', async () => {
      const id = await ticket();

      expect(nombresEmitidos()).toEqual([TICKET_CREADO]);
      const evento = ultimo()[1] as TicketCreado;
      expect(evento).toBeInstanceOf(TicketCreado);
      expect(evento.ticket).toEqual(expect.objectContaining({ id, payer_id: JUAN, category: 'supplies' }));
      expect(evento.deudas).toHaveLength(4); // 2 productos × 2 deudores
    });

    it('y cada persona recibe un único aviso con su total del ticket, no uno por producto', async () => {
      const id = await ticket();

      expect(deTipo(ANA, 'expense_added')).toEqual([expect.objectContaining({ reference_id: id })]);
      expect(texto(deTipo(ANA, 'expense_added')[0])).toBe('Juan Pérez solicita 2,00 € por la compra.');
      expect(deTipo(LUIS, 'expense_added')).toHaveLength(1);
    });
  });

  describe('editar', () => {
    it('emite GASTO_EDITADO con las deudas de antes y las de después', async () => {
      const { id, version } = await cena();

      exito(await como(JUAN).patch(`/expenses/${id}`, { version, amount: '45' }));

      expect(nombresEmitidos()).toEqual([GASTO_CREADO, GASTO_EDITADO]);
      const evento = ultimo()[1] as GastoEditado;
      expect(evento).toBeInstanceOf(GastoEditado);
      expect(evento.actorId).toBe(JUAN);
      // Como número: Prisma devuelve Decimal y el Prisma en memoria, el texto guardado
      const importes = (deudas: GastoEditado['antes']) =>
        deudas.map((deuda) => [deuda.to_user_id, Number(String(deuda.amount))]).sort();
      expect(importes(evento.antes)).toEqual([[ANA, 10], [LUIS, 10]]);
      expect(importes(evento.despues)).toEqual([[ANA, 15], [LUIS, 15]]);
    });

    it('al responder, cada deudor tiene un «Gasto modificado» con lo que ahora le toca', async () => {
      const { id, version } = await cena();

      exito(await como(JUAN).patch(`/expenses/${id}`, { version, amount: '45' }));

      expect(texto(deTipo(ANA, 'expense_updated')[0])).toBe(
        'Juan Pérez ha cambiado «Cena del viernes»: ahora te toca pagar 15,00 €.',
      );
      expect(deTipo(LUIS, 'expense_updated')).toHaveLength(1);
    });

    it('al sacar a Luis del gasto, Ana recibe «Gasto modificado» y Luis «Gasto eliminado»', async () => {
      const { id, version } = await cena();

      exito(await como(JUAN).patch(`/expenses/${id}`, { version, participant_ids: [JUAN, ANA] }));

      expect(texto(deTipo(ANA, 'expense_updated')[0])).toBe(
        'Juan Pérez ha cambiado «Cena del viernes»: ahora te toca pagar 15,00 €.',
      );
      expect(texto(deTipo(LUIS, 'expense_deleted')[0])).toBe(
        'Juan Pérez ha eliminado «Cena del viernes» (10,00 €). Ya no le debes ese importe.',
      );
    });

    it('con una versión vieja (409) no se emite nada', async () => {
      const { id, version } = await cena();
      exito(await como(JUAN).patch(`/expenses/${id}`, { version, amount: '45' }));

      const vieja = await como(JUAN).patch(`/expenses/${id}`, { version, amount: '60' });

      expect(vieja.status).toBe(409);
      expect(nombresEmitidos()).toEqual([GASTO_CREADO, GASTO_EDITADO]);
    });

    it('si no es quien pagó (403), no se emite nada', async () => {
      const { id, version } = await cena();

      const respuesta = await como(ANA).patch(`/expenses/${id}`, { version, amount: '3' });

      expect(respuesta.status).toBe(403);
      expect(nombresEmitidos()).toEqual([GASTO_CREADO]);
      expect(deTipo(LUIS, 'expense_updated')).toEqual([]);
    });
  });

  describe('borrar', () => {
    it('un gasto emite GASTO_BORRADO con sus deudas y cada deudor recibe un «Gasto eliminado»', async () => {
      const { id, version } = await cena();

      exito(await como(JUAN).delete(`/expenses/${id}?version=${version}`));

      expect(nombresEmitidos()).toEqual([GASTO_CREADO, GASTO_BORRADO]);
      const evento = ultimo()[1] as GastoBorrado;
      expect(evento).toBeInstanceOf(GastoBorrado);
      expect(evento.deudas.map((deuda) => deuda.to_user_id).sort()).toEqual([ANA, LUIS].sort());
      expect(deTipo(ANA, 'expense_deleted')).toHaveLength(1);
      expect(deTipo(LUIS, 'expense_deleted')).toHaveLength(1);
    });

    it('si no es quien pagó (403), no se emite nada y el gasto sigue', async () => {
      const { id, version } = await cena();

      const respuesta = await como(LUIS).delete(`/expenses/${id}?version=${version}`);

      expect(respuesta.status).toBe(403);
      expect(nombresEmitidos()).toEqual([GASTO_CREADO]);
      expect(db.filasDe('Expense')).toHaveLength(1);
    });

    it('un ticket entero emite un TICKET_BORRADO con las deudas de todos sus productos', async () => {
      const id = await ticket();
      const version = db.filasDe('Receipt')[0].version as number;

      exito(await como(JUAN).delete(`/receipts/${id}?version=${version}`));

      expect(nombresEmitidos()).toEqual([TICKET_CREADO, TICKET_BORRADO]);
      const evento = ultimo()[1] as TicketBorrado;
      expect(evento).toBeInstanceOf(TicketBorrado);
      expect(evento.ticket.id).toBe(id);
      expect(evento.deudas).toHaveLength(4);
      expect(texto(deTipo(ANA, 'expense_deleted')[0])).toBe(
        'Juan Pérez ha eliminado la compra (2,00 €). Ya no le debes ese importe.',
      );
      expect(deTipo(LUIS, 'expense_deleted')).toHaveLength(1);
    });
  });

  describe('pagos', () => {
    // Ana dice que le ha pagado a Juan sus 10 € de la cena
    async function anaMarcaElPago() {
      await cena();
      const respuesta = await como(ANA).post(`/transactions/${PISO}/settle`, { acreedor_id: JUAN, amount: '10.00' });
      exito(respuesta);
      return (respuesta.body as { id: string }).id;
    }

    it('marcar el pago emite PAGO_MARCADO y Juan ya tiene su aviso al responder', async () => {
      const pago = await anaMarcaElPago();

      expect(nombresEmitidos()).toEqual([GASTO_CREADO, PAGO_MARCADO]);
      const evento = ultimo()[1] as PagoMarcado;
      expect(evento).toBeInstanceOf(PagoMarcado);
      expect(evento.pago).toEqual(expect.objectContaining({ id: pago, from_user_id: ANA, to_user_id: JUAN }));
      expect(deTipo(JUAN, 'payment_marked')).toEqual([expect.objectContaining({ reference_id: pago, is_read: false })]);
    });

    it('marcarlo otra vez (409) no emite otro evento', async () => {
      await anaMarcaElPago();

      const otraVez = await como(ANA).post(`/transactions/${PISO}/settle`, { acreedor_id: JUAN, amount: '10.00' });

      expect(otraVez.status).toBe(409);
      expect(nombresEmitidos()).toEqual([GASTO_CREADO, PAGO_MARCADO]);
    });

    it('confirmar emite PAGO_CONFIRMADO: Ana recibe el aviso y el de Juan queda leído', async () => {
      const pago = await anaMarcaElPago();

      exito(await como(JUAN).post(`/transactions/${pago}/confirm`));

      expect(nombresEmitidos()).toEqual([GASTO_CREADO, PAGO_MARCADO, PAGO_CONFIRMADO]);
      expect(ultimo()[1]).toBeInstanceOf(PagoConfirmado);
      expect((ultimo()[1] as PagoConfirmado).pago.id).toBe(pago);
      expect(deTipo(ANA, 'payment_confirmed')).toHaveLength(1);
      expect(deTipo(JUAN, 'payment_marked')[0].is_read).toBe(true);
    });

    it('rechazar emite PAGO_RECHAZADO: Ana recibe el aviso y el de Juan queda leído', async () => {
      const pago = await anaMarcaElPago();

      exito(await como(JUAN).post(`/transactions/${pago}/reject`));

      expect(nombresEmitidos()).toEqual([GASTO_CREADO, PAGO_MARCADO, PAGO_RECHAZADO]);
      expect(ultimo()[1]).toBeInstanceOf(PagoRechazado);
      expect(deTipo(ANA, 'payment_rejected')).toHaveLength(1);
      expect(deTipo(JUAN, 'payment_marked')[0].is_read).toBe(true);
    });

    it('confirmar quien no es el acreedor no emite nada', async () => {
      const pago = await anaMarcaElPago();

      const respuesta = await como(LUIS).post(`/transactions/${pago}/confirm`);

      expect(respuesta.status).toBeGreaterThanOrEqual(400);
      expect(nombresEmitidos()).toEqual([GASTO_CREADO, PAGO_MARCADO]);
      expect(deTipo(ANA, 'payment_confirmed')).toEqual([]);
    });
  });
});

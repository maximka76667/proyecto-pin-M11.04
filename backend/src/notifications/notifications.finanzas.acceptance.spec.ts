import {
  ANA,
  CARLA,
  PISO,
  avisoDeGastos,
  avisoEnBaseDeDatos,
  avisoGuardado,
  exito,
  prepararNotificaciones,
} from '../../test/notificaciones-tareas';

// Pruebas de aceptación de notificaciones financieras en el panel del perfil.
describe('Notificaciones financieras · pruebas de aceptación', () => {
  const { avisosDe, sinLeerDe, marcarLeido } = prepararNotificaciones();

  it('PA · muestra los avisos financieros del usuario y del hogar activo, ordenados y con su estado', async () => {
    avisoDeGastos(CARLA, 'expense_added', {
      created_at: new Date('2026-11-10T09:00:00.000Z'),
    });
    const leido = avisoDeGastos(ANA, 'payment_confirmed', {
      title: 'Pago confirmado',
      body: 'Juan ha confirmado tu pago de 15,00 €.',
      is_read: true,
      created_at: new Date('2026-11-10T08:00:00.000Z'),
    });
    const reciente = avisoDeGastos(ANA, 'expense_added', {
      created_at: new Date('2026-11-11T08:00:00.000Z'),
    });
    avisoDeGastos(ANA, 'expense_deleted', {
      apartment_id: '55555555-5555-4555-8555-555555555555',
    });

    const avisos = await avisosDe(ANA, PISO, '&category=finances');

    expect(avisos.map(({ id }) => id)).toEqual([reciente.id, leido.id]);
    expect(avisos.map(({ is_read }) => is_read)).toEqual([false, true]);
    expect(avisos[0]).toEqual(expect.objectContaining({
      type: 'expense_added',
      title: 'Aviso de cobro',
      body: 'Beto Ruiz solicita 15,00 € por la compra.',
    }));
    expect(await sinLeerDe(ANA, PISO, '&category=finances')).toBe(1);
  });

  it('PA · marca un aviso financiero como leído y actualiza el contador de pendientes', async () => {
    const aviso = avisoDeGastos(ANA, 'expense_added');
    avisoDeGastos(ANA, 'payment_marked');

    const respuesta = await marcarLeido(ANA, aviso.id);

    exito(respuesta);
    expect(respuesta.body).toEqual(expect.objectContaining({ id: aviso.id, is_read: true }));
    expect(avisoEnBaseDeDatos(aviso.id)?.is_read).toBe(true);
    expect(await sinLeerDe(ANA, PISO, '&category=finances')).toBe(1);
    expect(await avisosDe(ANA, PISO, '&category=finances')).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: aviso.id, is_read: true }),
      expect.objectContaining({ type: 'payment_marked', is_read: false }),
    ]));
  });

  it('PA · cuando no hay avisos financieros devuelve una lista vacía y ningún pendiente', async () => {
    avisoGuardado({ user_id: ANA }); // Un aviso de tareas no debe aparecer en esta pestaña.

    expect(await avisosDe(ANA, PISO, '&category=finances')).toEqual([]);
    expect(await sinLeerDe(ANA, PISO, '&category=finances')).toBe(0);
  });

  it('PA · impide marcar como leído el aviso financiero de otro usuario y conserva su estado', async () => {
    const deCarla = avisoDeGastos(CARLA, 'payment_marked');
    const estadoInicial = { ...deCarla };

    const respuesta = await marcarLeido(ANA, deCarla.id);

    expect(respuesta.status).toBe(403);
    expect(avisoEnBaseDeDatos(deCarla.id)).toEqual(estadoInicial);
  });
});

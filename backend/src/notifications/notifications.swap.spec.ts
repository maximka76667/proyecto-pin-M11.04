import {
  ANA,
  BETO,
  CARLA,
  TAREA_A,
  TAREA_LIBRE,
  avisoEnBaseDeDatos,
  exito,
  prepararNotificaciones,
} from '../../test/notificaciones-tareas';

// UT1019 · notificaciones de tareas
// PA 2250-1: Interacción y navegación desde una solicitud de intercambio (Swap). Al pulsar el
// aviso «Solicitud de Swap» se marca como leído y la app abre la petición para aceptarla o
// rechazarla. Observación: el aviso guarda un reference_id que dice a la app a dónde ir

describe('UT1019 · PA 2250-1 · interacción y navegación desde una solicitud de intercambio', () => {
  const { avisosDe, sinLeerDe, marcarLeido, asignar, solicitudDeAnaABeto, aceptar, rechazar, cancelar } =
    prepararNotificaciones();

  it('la solicitud de Ana crea un aviso para Beto que apunta a esa petición', async () => {
    const id = await solicitudDeAnaABeto();

    const avisos = await avisosDe(BETO);

    expect(avisos).toEqual([
      expect.objectContaining({ type: 'swap_requested', reference_id: id, is_read: false }),
    ]);
    expect(avisos[0].body).toContain('Ana García');
    expect(avisos[0].body).toContain('Fregar los platos');
    expect(avisos[0].body).toContain('Sacar la basura');
  });

  it('solo avisa a quien tiene que responder: ni a Ana, que la envía, ni a Carla', async () => {
    await solicitudDeAnaABeto();

    expect(await avisosDe(ANA)).toEqual([]);
    expect(await avisosDe(CARLA)).toEqual([]);
  });

  it('al tocar el aviso, Beto lo marca como leído', async () => {
    await solicitudDeAnaABeto();
    const [aviso] = await avisosDe(BETO);

    exito(await marcarLeido(BETO, aviso.id));

    expect(avisoEnBaseDeDatos(aviso.id)?.is_read).toBe(true);
    expect(await sinLeerDe(BETO)).toBe(0);
  });

  it('con el reference_id del aviso, Beto puede aceptar la petición', async () => {
    await solicitudDeAnaABeto();
    const [aviso] = await avisosDe(BETO);
    exito(await marcarLeido(BETO, aviso.id));

    exito(await aceptar(BETO, aviso.reference_id as string));

    expect(await avisosDe(ANA)).toEqual([expect.objectContaining({ type: 'swap_accepted' })]);
  });

  it.each([
    ['acepta', aceptar],
    ['rechaza', rechazar],
  ])('si Beto %s desde la pantalla de intercambios, su aviso de solicitud deja de estar pendiente', async (_respuesta, responder) => {
    const id = await solicitudDeAnaABeto();
    expect(await sinLeerDe(BETO)).toBe(1);

    exito(await responder(BETO, id));

    expect(await sinLeerDe(BETO)).toBe(0);
    expect(await avisosDe(BETO)).toEqual([
      expect.objectContaining({ type: 'swap_requested', is_read: true }),
    ]);
  });

  it('si Ana cancela la solicitud, el aviso de Beto desaparece: ya no hay nada que responder', async () => {
    const id = await solicitudDeAnaABeto();

    exito(await cancelar(ANA, id));

    expect(await avisosDe(BETO)).toEqual([]);
    expect(await sinLeerDe(BETO)).toBe(0);
  });

  it('el aviso de aceptación apunta a la petición, que sigue guardada como completada', async () => {
    const id = await solicitudDeAnaABeto();
    exito(await aceptar(BETO, id));

    expect(await avisosDe(ANA)).toEqual([
      expect.objectContaining({ type: 'swap_accepted', reference_id: id }),
    ]);
  });

  it('el aviso de rechazo apunta a la tarea que ofrecía Ana, porque la petición ya no existe', async () => {
    const id = await solicitudDeAnaABeto();
    exito(await rechazar(BETO, id));

    expect(await avisosDe(ANA)).toEqual([
      expect.objectContaining({ type: 'swap_rejected', reference_id: TAREA_A }),
    ]);
  });

  it('los avisos de tareas apuntan a la tarea, para abrir su detalle', async () => {
    exito(await asignar(BETO, TAREA_LIBRE, [ANA]));

    expect(await avisosDe(ANA)).toEqual([
      expect.objectContaining({ type: 'task_assigned', reference_id: TAREA_LIBRE }),
    ]);
  });
});

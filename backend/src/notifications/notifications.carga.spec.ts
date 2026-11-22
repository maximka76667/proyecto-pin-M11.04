import { Logger } from '@nestjs/common';
import {
  ANA,
  ASIG_A,
  BETO,
  CARLA,
  DANI,
  JUEVES,
  JUEVES_9H,
  OTRO_PISO,
  PISO,
  TAREA_A,
  TAREA_LIBRE,
  TAREA_X,
  TIPOS_DE_GASTOS,
  TIPOS_DE_TAREAS,
  VIERNES,
  avisoDeGastos,
  avisoGuardado,
  avisosGuardados,
  db,
  exito,
  otraTareaDe,
  prepararNotificaciones,
} from '../../test/notificaciones-tareas';

// UT1019 · notificaciones de tareas
// PA 2248-1: Carga y visualización de notificaciones de tareas. El usuario abre la pestaña de
// notificaciones de tareas y ve todos sus avisos, cuáles están leídos y de qué tipo es cada uno.
// Observación: la consulta lleva siempre el usuario y el piso activo en el WHERE, para que no se
// crucen datos de otras áreas de la app (finanzas frente a tareas)

describe('UT1019 · PA 2248-1 · carga y visualización de notificaciones de tareas', () => {
  const { servidor, como, avisosDe, sinLeerDe, marcarLeido, asignar, solicitudDeAnaABeto, aceptar, rechazar } =
    prepararNotificaciones();

  it('devuelve los avisos del usuario, del más reciente al más antiguo, y dice cuáles están leídos', async () => {
    const antiguo = avisoGuardado({
      user_id: ANA,
      is_read: true,
      created_at: new Date('2026-11-07T08:00:00.000Z'),
    });
    const reciente = avisoGuardado({
      user_id: ANA,
      type: 'swap_requested',
      title: 'Solicitud de intercambio',
      created_at: new Date('2026-11-10T07:55:00.000Z'),
    });
    const intermedio = avisoGuardado({
      user_id: ANA,
      type: 'swap_rejected',
      title: 'Intercambio rechazado',
      created_at: new Date('2026-11-09T08:00:00.000Z'),
    });

    const avisos = await avisosDe(ANA);

    expect(avisos.map((aviso) => aviso.id)).toEqual([reciente.id, intermedio.id, antiguo.id]);
    expect(avisos.map((aviso) => aviso.is_read)).toEqual([false, false, true]);
    expect(avisos.map((aviso) => aviso.type)).toEqual(['swap_requested', 'swap_rejected', 'task_assigned']);
  });

  it('cada aviso trae lo que la app necesita para pintarlo y saber a dónde lleva', async () => {
    const guardado = avisoGuardado({ user_id: ANA });

    const [aviso] = await avisosDe(ANA);

    expect(aviso).toEqual({
      id: guardado.id,
      type: 'task_assigned',
      title: 'Nueva tarea asignada',
      body: 'Beto Ruiz te ha asignado «Fregar los platos» para el 12 nov a las 10:00.',
      reference_id: TAREA_A,
      is_read: false,
      created_at: '2026-11-09T08:00:00.000Z',
    });
  });

  it('sin avisos devuelve una lista vacía y cero pendientes', async () => {
    expect(await avisosDe(ANA)).toEqual([]);
    expect(await sinLeerDe(ANA)).toBe(0);
  });

  it('el contador dice cuántos avisos quedan sin leer', async () => {
    avisoGuardado({ user_id: ANA });
    avisoGuardado({ user_id: ANA });
    avisoGuardado({ user_id: ANA, is_read: true });

    expect(await sinLeerDe(ANA)).toBe(2);
  });

  describe('tipos de avisos', () => {
    it('asignación: cuando Beto le asigna una tarea a Ana, ella recibe el aviso con quién, qué tarea, el día y la hora', async () => {
      exito(await asignar(BETO, TAREA_LIBRE, [ANA]));

      const avisos = await avisosDe(ANA);

      expect(avisos).toEqual([
        expect.objectContaining({
          type: 'task_assigned',
          is_read: false,
          reference_id: TAREA_LIBRE,
        }),
      ]);
      expect(avisos[0].body).toContain('Beto Ruiz');
      expect(avisos[0].body).toContain('Limpiar el baño');
      expect(avisos[0].body).toContain('13 nov');
      expect(avisos[0].body).toContain('16:00');
    });

    it('asignación a varios: avisa a cada persona asignada, menos a quien hace la asignación', async () => {
      exito(await asignar(BETO, TAREA_LIBRE, [BETO, CARLA, ANA]));

      expect(await avisosDe(BETO)).toEqual([]);
      expect(await avisosDe(CARLA)).toEqual([expect.objectContaining({ type: 'task_assigned' })]);
      expect(await avisosDe(ANA)).toEqual([expect.objectContaining({ type: 'task_assigned' })]);
    });

    it('respuesta a un intercambio: si Beto acepta, Ana recibe el aviso con la tarea que ahora le toca', async () => {
      const id = await solicitudDeAnaABeto();
      exito(await aceptar(BETO, id));

      const avisos = await avisosDe(ANA);

      expect(avisos).toEqual([expect.objectContaining({ type: 'swap_accepted', is_read: false })]);
      expect(avisos[0].body).toContain('Beto Ruiz');
      expect(avisos[0].body).toContain('Sacar la basura');
    });

    it('respuesta a un intercambio: si Beto rechaza, Ana recibe el aviso del rechazo', async () => {
      const id = await solicitudDeAnaABeto();
      exito(await rechazar(BETO, id));

      const avisos = await avisosDe(ANA);

      expect(avisos).toEqual([expect.objectContaining({ type: 'swap_rejected', is_read: false })]);
      expect(avisos[0].body).toContain('Beto Ruiz');
      expect(avisos[0].body).toContain('Fregar los platos');
    });

    it('si el aviso no se puede guardar, la tarea se asigna igual', async () => {
      const registro = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      db.prisma.notification.createMany.mockImplementationOnce(() => {
        throw new Error('la base de datos no responde');
      });

      const respuesta = await asignar(BETO, TAREA_LIBRE, [ANA]);

      exito(respuesta);
      expect(db.filasDe('TaskAssignment')).toContainEqual(
        expect.objectContaining({ task_id: TAREA_LIBRE, user_id: ANA }),
      );
      expect(avisosGuardados()).toEqual([]);
      expect(registro).toHaveBeenCalled();
      registro.mockRestore();
    });
  });

  // Vencimiento próximo: no hay ningún proceso programado, el aviso se crea al consultar
  describe('vencimiento próximo', () => {
    beforeEach(() => {
      jest.setSystemTime(JUEVES_9H);
    });

    it('una tarea que vence hoy más tarde genera el aviso «vence hoy a las 10:00»', async () => {
      const avisos = await avisosDe(ANA);

      expect(avisos).toEqual([
        expect.objectContaining({
          type: 'task_due_soon',
          body: '«Fregar los platos» vence hoy a las 10:00.',
          reference_id: TAREA_A,
          is_read: false,
        }),
      ]);
    });

    it('avisa solo de lo que vence en las próximas 24 horas', async () => {
      otraTareaDe(ANA, 'Poner la lavadora', JUEVES, '08:30'); // ya ha pasado
      otraTareaDe(ANA, 'Tender la ropa', VIERNES, '08:00'); // mañana, antes de esta hora
      otraTareaDe(ANA, 'Limpiar la nevera', VIERNES, '09:30'); // mañana, a más de 24 horas
      otraTareaDe(ANA, 'Bajar el vidrio', '2026-11-14', '08:00'); // pasado mañana
      otraTareaDe(ANA, 'Hacer la compra', JUEVES, '11:00', 'completed'); // ya está hecha

      const cuerpos = (await avisosDe(ANA)).map((aviso) => aviso.body).sort();

      expect(cuerpos).toEqual([
        '«Fregar los platos» vence hoy a las 10:00.',
        '«Tender la ropa» vence mañana a las 08:00.',
      ]);
    });

    it('no avisa a Ana de las tareas de sus compañeros ni de las de otro piso', async () => {
      await avisosDe(ANA);

      expect(avisosGuardados()).toEqual([
        expect.objectContaining({ user_id: ANA, assignment_id: ASIG_A }),
      ]);
    });

    it('cada tarea avisa una sola vez, aunque se consulte varias veces o a la vez', async () => {
      await avisosDe(ANA);
      await sinLeerDe(ANA);
      await Promise.all([avisosDe(ANA), sinLeerDe(ANA), avisosDe(ANA)]);

      expect(avisosGuardados()).toHaveLength(1);
      expect(await sinLeerDe(ANA)).toBe(1);
    });

    it('una tarea nueva que vence pronto se añade a los avisos sin repetir los que ya había', async () => {
      await avisosDe(ANA);
      otraTareaDe(ANA, 'Tender la ropa', JUEVES, '20:00');

      const cuerpos = (await avisosDe(ANA)).map((aviso) => aviso.body).sort();

      expect(cuerpos).toEqual([
        '«Fregar los platos» vence hoy a las 10:00.',
        '«Tender la ropa» vence hoy a las 20:00.',
      ]);
    });

    it('el contador también cuenta el recordatorio, sin haber abierto antes la lista', async () => {
      expect(await sinLeerDe(ANA)).toBe(1);
    });

    it('un recordatorio ya leído no vuelve a salir como nuevo', async () => {
      const [aviso] = await avisosDe(ANA);
      exito(await marcarLeido(ANA, aviso.id));

      expect(await avisosDe(ANA)).toEqual([expect.objectContaining({ id: aviso.id, is_read: true })]);
      expect(await sinLeerDe(ANA)).toBe(0);
    });

    it('con los recordatorios apagados en el perfil (reminders=false) no se crean ni se cuentan', async () => {
      expect(await avisosDe(ANA, PISO, '&reminders=false')).toEqual([]);
      expect(await sinLeerDe(ANA, PISO, '&reminders=false')).toBe(0);
      expect(avisosGuardados()).toEqual([]);
    });

    it('con los recordatorios apagados, los que ya existían se ocultan y el resto de avisos sigue saliendo', async () => {
      await avisosDe(ANA);
      const asignada = avisoGuardado({ user_id: ANA });

      expect(await avisosDe(ANA, PISO, '&reminders=false')).toEqual([
        expect.objectContaining({ id: asignada.id }),
      ]);
      expect(await sinLeerDe(ANA, PISO, '&reminders=false')).toBe(1);
      expect(await sinLeerDe(ANA)).toBe(2);
    });

    it('tras un intercambio aceptado, el recordatorio se va con la tarea a su nuevo dueño', async () => {
      await avisosDe(ANA);
      await avisosDe(BETO);
      const id = await solicitudDeAnaABeto();
      exito(await aceptar(BETO, id));

      const deAna = (await avisosDe(ANA)).filter((aviso) => aviso.type === 'task_due_soon');
      const deBeto = (await avisosDe(BETO)).filter((aviso) => aviso.type === 'task_due_soon');

      expect(deAna.map((aviso) => aviso.body)).toEqual(['«Sacar la basura» vence hoy a las 18:00.']);
      expect(deBeto.map((aviso) => aviso.body)).toEqual(['«Fregar los platos» vence hoy a las 10:00.']);
    });

    it('si se quita la asignación, sus avisos desaparecen con ella', async () => {
      await avisosDe(ANA);
      expect(avisosGuardados()).toHaveLength(1);

      exito(await como(BETO).delete(`/tasks/assignments/${ASIG_A}`));

      expect(await avisosDe(ANA)).toEqual([]);
    });
  });

  // Observación: la consulta lleva siempre el usuario y el piso activo en el WHERE
  describe('solo los avisos del usuario en su piso', () => {
    it('no salen los avisos de un compañero del mismo piso', async () => {
      avisoGuardado({ user_id: CARLA });
      const suyo = avisoGuardado({ user_id: ANA });

      expect((await avisosDe(ANA)).map((aviso) => aviso.id)).toEqual([suyo.id]);
      expect(await sinLeerDe(ANA)).toBe(1);
    });

    it('si vive en dos pisos, en cada uno ve solo los avisos de ese piso', async () => {
      db.filasDe('UserApartment').push({ user_id: ANA, apartment_id: OTRO_PISO });
      const delPiso = avisoGuardado({ user_id: ANA, apartment_id: PISO });
      const delOtro = avisoGuardado({ user_id: ANA, apartment_id: OTRO_PISO, reference_id: TAREA_X });

      expect((await avisosDe(ANA, PISO)).map((aviso) => aviso.id)).toEqual([delPiso.id]);
      expect((await avisosDe(ANA, OTRO_PISO)).map((aviso) => aviso.id)).toEqual([delOtro.id]);
      expect(await sinLeerDe(ANA, PISO)).toBe(1);
      expect(await sinLeerDe(ANA, OTRO_PISO)).toBe(1);
    });

    it('quien no vive en el piso no puede consultar sus avisos (403)', async () => {
      avisoGuardado({ user_id: ANA });

      const lista = await como(DANI).get(`/notifications?apartment_id=${PISO}`);
      const contador = await como(DANI).get(`/notifications/unread-count?apartment_id=${PISO}`);

      expect(lista.status).toBe(403);
      expect(contador.status).toBe(403);
    });

    it.each([
      ['sin apartment_id', ''],
      ['con un apartment_id que no es un UUID', '?apartment_id=mi-piso'],
      ['con un valor de reminders que no es true ni false', `?apartment_id=${PISO}&reminders=quizas`],
      ['con una categoría que no es tasks ni finances', `?apartment_id=${PISO}&category=compras`],
    ])('%s responde 400', async (_caso, consulta) => {
      const respuesta = await como(ANA).get(`/notifications${consulta}`);

      expect(respuesta.status).toBe(400);
    });

    it('sin una sesión válida responde 401', async () => {
      const respuesta = await servidor()
        .get(`/notifications?apartment_id=${PISO}`)
        .set('Authorization', 'Bearer token-caducado');

      expect(respuesta.status).toBe(401);
    });
  });

  // Observación: los avisos de tareas no se cruzan con los de finanzas (UT1018). La pestaña de
  // notificaciones de tareas pide category=tasks
  describe('pestaña Tareas: sin avisos de gastos', () => {
    function unoDeCadaTipo() {
      const deTareas = TIPOS_DE_TAREAS.map((type) => avisoGuardado({ user_id: ANA, type }));
      const deGastos = TIPOS_DE_GASTOS.map((type) => avisoDeGastos(ANA, type));
      return { deTareas, deGastos };
    }

    it('con category=tasks salen todos los tipos de avisos de tareas y ninguno de gastos', async () => {
      const { deTareas } = unoDeCadaTipo();

      const avisos = await avisosDe(ANA, PISO, '&category=tasks');

      expect(avisos.map((aviso) => aviso.id).sort()).toEqual(deTareas.map((aviso) => aviso.id).sort());
      expect(avisos.map((aviso) => aviso.type).sort()).toEqual([...TIPOS_DE_TAREAS].sort());
    });

    it('sin categoría salen todos, los de tareas y los de gastos', async () => {
      unoDeCadaTipo();

      expect(await avisosDe(ANA)).toHaveLength(TIPOS_DE_TAREAS.length + TIPOS_DE_GASTOS.length);
    });

    it('el contador con category=tasks solo cuenta los avisos de tareas sin leer', async () => {
      const { deTareas } = unoDeCadaTipo();
      deTareas[0].is_read = true;

      expect(await sinLeerDe(ANA, PISO, '&category=tasks')).toBe(TIPOS_DE_TAREAS.length - 1);
      expect(await sinLeerDe(ANA)).toBe(TIPOS_DE_TAREAS.length - 1 + TIPOS_DE_GASTOS.length);
    });

    it('tampoco salen los avisos de gastos de un compañero', async () => {
      avisoDeGastos(CARLA, 'expense_added');
      const suyo = avisoGuardado({ user_id: ANA });

      expect((await avisosDe(ANA, PISO, '&category=tasks')).map((aviso) => aviso.id)).toEqual([suyo.id]);
    });

    it('el recordatorio de vencimiento sale en la pestaña Tareas y no en la de gastos, que ni lo crea', async () => {
      jest.setSystemTime(JUEVES_9H);

      expect(await avisosDe(ANA, PISO, '&category=finances')).toEqual([]);
      expect(avisosGuardados()).toEqual([]);

      expect(await avisosDe(ANA, PISO, '&category=tasks')).toEqual([
        expect.objectContaining({ type: 'task_due_soon', reference_id: TAREA_A }),
      ]);
    });
  });
});

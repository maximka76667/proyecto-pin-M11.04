import { Logger } from '@nestjs/common';
import {
  ANA,
  ASIG_ANA,
  ASIG_LUIS,
  DANI,
  JUAN,
  LUIS,
  TAREA_ANA,
  TAREA_LIBRE,
  TAREA_OTRO_PISO,
  VIERNES,
  db,
  deTipo,
  exito,
  prepararObservador,
} from '../../test/observador';
import {
  INTERCAMBIO_ACEPTADO,
  INTERCAMBIO_CANCELADO,
  INTERCAMBIO_RECHAZADO,
  INTERCAMBIO_SOLICITADO,
  IntercambioAceptado,
  IntercambioCancelado,
  IntercambioRechazado,
  IntercambioSolicitado,
  TAREA_ASIGNADA,
  TareaAsignada,
} from '../tasks/task.events';

// Patrón Observer · los sujetos de tareas (UT1019). Por HTTP, con TasksService y
// TaskSwapsService reales: cada acción emite su evento una sola vez, con sus datos, solo cuando
// se ha guardado, y el aviso que crea el observador ya está en la base de datos al responder

describe('Patrón Observer · tareas e intercambios (los sujetos)', () => {
  const { como, emitidos, nombresEmitidos } = prepararObservador();

  const asignar = (quien: string, tarea: string, personas: string[]) =>
    como(quien).post(`/tasks/${tarea}/assignments`, { user_ids: personas, due_date: VIERNES, due_time: '16:00' });

  // Ana ofrece su «Fregar los platos» a cambio de «Sacar la basura» de Luis
  async function pedirIntercambio() {
    const respuesta = await como(ANA).post('/tasks/swap-requests', {
      from_assignment_id: ASIG_ANA,
      to_assignment_id: ASIG_LUIS,
    });
    exito(respuesta);
    return (respuesta.body as { id: string }).id;
  }

  describe('asignar una tarea', () => {
    it('emite TAREA_ASIGNADA una vez, con la tarea, quién asigna y a quién', async () => {
      exito(await asignar(JUAN, TAREA_LIBRE, [ANA, LUIS]));

      expect(nombresEmitidos()).toEqual([TAREA_ASIGNADA]);
      const [, evento] = emitidos()[0];
      expect(evento).toBeInstanceOf(TareaAsignada);
      expect((evento as TareaAsignada).asignacion).toEqual(
        expect.objectContaining({
          taskId: TAREA_LIBRE,
          assignerId: JUAN,
          dueTime: '16:00',
          assignments: [
            expect.objectContaining({ user_id: ANA }),
            expect.objectContaining({ user_id: LUIS }),
          ],
        }),
      );
    });

    it('cuando llega la respuesta, el observador ya ha guardado el aviso de cada persona', async () => {
      exito(await asignar(JUAN, TAREA_LIBRE, [ANA, LUIS]));

      expect(deTipo(ANA, 'task_assigned')).toHaveLength(1);
      expect(deTipo(LUIS, 'task_assigned')).toHaveLength(1);
      expect(deTipo(JUAN, 'task_assigned')).toHaveLength(0);
    });

    it('si la asignación no se hace (tarea de otro piso: 403), no se emite nada', async () => {
      const respuesta = await asignar(JUAN, TAREA_OTRO_PISO, [ANA]);

      expect(respuesta.status).toBe(403);
      expect(nombresEmitidos()).toEqual([]);
      expect(db.filasDe('Notification')).toEqual([]);
    });

    it('si guardar la asignación falla, no se emite nada', async () => {
      const registro = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      db.prisma.taskAssignment.create.mockImplementationOnce(() => {
        throw new Error('la base de datos no responde');
      });

      const respuesta = await asignar(JUAN, TAREA_LIBRE, [ANA]);

      expect(respuesta.status).toBeGreaterThanOrEqual(500);
      expect(nombresEmitidos()).toEqual([]);
      registro.mockRestore();
    });
  });

  describe('intercambios', () => {
    it('pedir emite INTERCAMBIO_SOLICITADO con la petición y las dos asignaciones', async () => {
      const id = await pedirIntercambio();

      expect(nombresEmitidos()).toEqual([INTERCAMBIO_SOLICITADO]);
      const evento = emitidos()[0][1] as IntercambioSolicitado;
      expect(evento).toBeInstanceOf(IntercambioSolicitado);
      expect(evento.peticion.id).toBe(id);
      expect(evento.peticion.from_assignment.id).toBe(ASIG_ANA);
      expect(evento.peticion.to_assignment.id).toBe(ASIG_LUIS);
      expect(deTipo(LUIS, 'swap_requested')).toEqual([expect.objectContaining({ reference_id: id })]);
    });

    it('aceptar emite INTERCAMBIO_ACEPTADO con la petición', async () => {
      const id = await pedirIntercambio();

      exito(await como(LUIS).post(`/tasks/swap-requests/${id}/accept`));

      expect(nombresEmitidos()).toEqual([INTERCAMBIO_SOLICITADO, INTERCAMBIO_ACEPTADO]);
      const evento = emitidos()[1][1] as IntercambioAceptado;
      expect(evento).toBeInstanceOf(IntercambioAceptado);
      expect(evento.peticion.id).toBe(id);
      expect(deTipo(ANA, 'swap_accepted')).toHaveLength(1);
    });

    it('rechazar emite INTERCAMBIO_RECHAZADO con la petición', async () => {
      const id = await pedirIntercambio();

      exito(await como(LUIS).post(`/tasks/swap-requests/${id}/reject`));

      expect(nombresEmitidos()).toEqual([INTERCAMBIO_SOLICITADO, INTERCAMBIO_RECHAZADO]);
      const evento = emitidos()[1][1] as IntercambioRechazado;
      expect(evento).toBeInstanceOf(IntercambioRechazado);
      expect(evento.peticion.from_assignment.task.id).toBe(TAREA_ANA);
      expect(deTipo(ANA, 'swap_rejected')).toEqual([expect.objectContaining({ reference_id: TAREA_ANA })]);
    });

    it('cancelar emite INTERCAMBIO_CANCELADO con el id y el aviso de Luis desaparece', async () => {
      const id = await pedirIntercambio();

      exito(await como(ANA).delete(`/tasks/swap-requests/${id}`));

      expect(nombresEmitidos()).toEqual([INTERCAMBIO_SOLICITADO, INTERCAMBIO_CANCELADO]);
      const evento = emitidos()[1][1] as IntercambioCancelado;
      expect(evento).toBeInstanceOf(IntercambioCancelado);
      expect(evento.peticionId).toBe(id);
      expect(deTipo(LUIS, 'swap_requested')).toEqual([]);
    });

    it.each([
      ['aceptar', 'accept'],
      ['rechazar', 'reject'],
    ])('si quien intenta %s no es el receptor (403), no se emite nada', async (_accion, ruta) => {
      const id = await pedirIntercambio();

      const respuesta = await como(JUAN).post(`/tasks/swap-requests/${id}/${ruta}`);

      expect(respuesta.status).toBe(403);
      expect(nombresEmitidos()).toEqual([INTERCAMBIO_SOLICITADO]);
    });

    it('responder a una petición ya resuelta (409) no emite otro evento', async () => {
      const id = await pedirIntercambio();
      exito(await como(LUIS).post(`/tasks/swap-requests/${id}/accept`));

      const otraVez = await como(LUIS).post(`/tasks/swap-requests/${id}/accept`);

      expect(otraVez.status).toBe(409);
      expect(nombresEmitidos()).toEqual([INTERCAMBIO_SOLICITADO, INTERCAMBIO_ACEPTADO]);
      expect(deTipo(ANA, 'swap_accepted')).toHaveLength(1);
    });

    it('cancelar quien no creó la petición (403) no emite nada ni borra el aviso', async () => {
      const id = await pedirIntercambio();

      const respuesta = await como(DANI).delete(`/tasks/swap-requests/${id}`);

      expect(respuesta.status).toBe(403);
      expect(nombresEmitidos()).toEqual([INTERCAMBIO_SOLICITADO]);
      expect(deTipo(LUIS, 'swap_requested')).toHaveLength(1);
    });
  });
});

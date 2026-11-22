import { randomUUID } from 'node:crypto';
import {
  ANA,
  PISO,
  avisoDeGastos,
  avisoEnBaseDeDatos,
  avisoGuardado,
  exito,
  prepararNotificaciones,
} from '../../test/notificaciones-tareas';

// UT1019 · notificaciones de tareas
// PA: Marcar un aviso de tarea como leído. El usuario pulsa el aviso o «Marcar como leída», la
// app envía el PATCH con el id y el registro pasa a is_read: true; el contador de pendientes del
// perfil baja en consecuencia

describe('UT1019 · PA · marcar un aviso de tarea como leído', () => {
  const { avisosDe, sinLeerDe, marcarLeido } = prepararNotificaciones();

  it('lo guarda como leído en la base de datos y devuelve el aviso ya leído', async () => {
    const guardado = avisoGuardado({ user_id: ANA });

    const respuesta = await marcarLeido(ANA, guardado.id);

    exito(respuesta);
    expect(respuesta.body).toEqual(expect.objectContaining({ id: guardado.id, is_read: true }));
    expect(avisoEnBaseDeDatos(guardado.id)?.is_read).toBe(true);
  });

  it('el contador de avisos pendientes baja en uno y los demás siguen sin leer', async () => {
    const uno = avisoGuardado({ user_id: ANA });
    const otro = avisoGuardado({ user_id: ANA });
    expect(await sinLeerDe(ANA)).toBe(2);

    exito(await marcarLeido(ANA, uno.id));

    expect(await sinLeerDe(ANA)).toBe(1);
    expect(avisoEnBaseDeDatos(otro.id)?.is_read).toBe(false);
  });

  it('en la pestaña Tareas el contador baja en uno y los avisos de gastos siguen sin leer', async () => {
    const deTareas = avisoGuardado({ user_id: ANA });
    avisoGuardado({ user_id: ANA, type: 'swap_requested' });
    const deGastos = avisoDeGastos(ANA, 'expense_added');
    expect(await sinLeerDe(ANA, PISO, '&category=tasks')).toBe(2);

    exito(await marcarLeido(ANA, deTareas.id));

    expect(await sinLeerDe(ANA, PISO, '&category=tasks')).toBe(1);
    expect(await sinLeerDe(ANA, PISO, '&category=finances')).toBe(1);
    expect(avisoEnBaseDeDatos(deGastos.id)?.is_read).toBe(false);
  });

  it('en la lista pasa a salir como leído', async () => {
    const guardado = avisoGuardado({ user_id: ANA });

    exito(await marcarLeido(ANA, guardado.id));

    expect(await avisosDe(ANA)).toEqual([expect.objectContaining({ id: guardado.id, is_read: true })]);
  });

  it('marcarlo dos veces no falla: sigue leído', async () => {
    const guardado = avisoGuardado({ user_id: ANA });
    exito(await marcarLeido(ANA, guardado.id));

    exito(await marcarLeido(ANA, guardado.id));

    expect(avisoEnBaseDeDatos(guardado.id)?.is_read).toBe(true);
  });

  it('un aviso que no existe responde 404', async () => {
    const respuesta = await marcarLeido(ANA, randomUUID());

    expect(respuesta.status).toBe(404);
  });

  it('un id que no es un UUID responde 400', async () => {
    const respuesta = await marcarLeido(ANA, 'el-primero');

    expect(respuesta.status).toBe(400);
  });
});

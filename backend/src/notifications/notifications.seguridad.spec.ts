import {
  ANA,
  CARLA,
  DANI,
  TOKENS,
  avisoEnBaseDeDatos,
  avisoGuardado,
  prepararNotificaciones,
} from '../../test/notificaciones-tareas';

// UT1019 · notificaciones de tareas
// PA: Prevención de manipulación de estado ajeno (Seguridad). El «Usuario A» (Ana) intenta marcar
// como leído un aviso del «Usuario C» (Carla) llamando directamente a la API: el servidor
// comprueba quién es el dueño, responde 403 y el aviso de Carla no cambia. Quién hace la petición
// sale siempre del token, nunca de lo que envíe la app

describe('UT1019 · PA · prevención de manipulación de estado ajeno (seguridad)', () => {
  const { servidor, avisosDe, sinLeerDe, marcarLeido } = prepararNotificaciones();

  it('Ana no puede marcar como leído un aviso de Carla: 403 y el aviso no cambia', async () => {
    const deCarla = avisoGuardado({ user_id: CARLA });
    const antes = { ...deCarla };

    const respuesta = await marcarLeido(ANA, deCarla.id);

    expect(respuesta.status).toBe(403);
    expect(avisoEnBaseDeDatos(deCarla.id)).toEqual(antes);
  });

  it('Carla sigue viéndolo sin leer', async () => {
    const deCarla = avisoGuardado({ user_id: CARLA });
    await marcarLeido(ANA, deCarla.id);

    expect(await sinLeerDe(CARLA)).toBe(1);
    expect(await avisosDe(CARLA)).toEqual([expect.objectContaining({ id: deCarla.id, is_read: false })]);
  });

  it('tampoco alguien de otro piso', async () => {
    const deCarla = avisoGuardado({ user_id: CARLA });

    const respuesta = await marcarLeido(DANI, deCarla.id);

    expect(respuesta.status).toBe(403);
    expect(avisoEnBaseDeDatos(deCarla.id)?.is_read).toBe(false);
  });

  it('con un token que no vale responde 401 y el aviso no cambia', async () => {
    const deCarla = avisoGuardado({ user_id: CARLA });

    const respuesta = await servidor()
      .patch(`/notifications/${deCarla.id}/read`)
      .set('Authorization', 'Bearer token-caducado');

    expect(respuesta.status).toBe(401);
    expect(avisoEnBaseDeDatos(deCarla.id)?.is_read).toBe(false);
  });

  it('quien hace la petición sale del token: enviar el user_id de Carla en el cuerpo no sirve de nada', async () => {
    const deCarla = avisoGuardado({ user_id: CARLA });

    const respuesta = await servidor()
      .patch(`/notifications/${deCarla.id}/read`)
      .set('Authorization', `Bearer ${TOKENS[ANA]}`)
      .send({ user_id: CARLA });

    expect(respuesta.status).toBe(403);
    expect(avisoEnBaseDeDatos(deCarla.id)?.is_read).toBe(false);
  });
});

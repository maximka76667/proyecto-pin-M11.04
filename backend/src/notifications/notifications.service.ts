import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AssignmentStatus, NotificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// Lo que la app recibe de cada aviso. `reference_id` es lo que se abre al tocarlo (PA 2250-1):
//   task_assigned, task_due_soon   → la tarea
//   swap_requested, swap_accepted  → la petición de intercambio (pantalla de intercambios)
//   swap_rejected                  → la tarea que ofrecía el emisor (la petición ya se borró)
const AVISO_SELECT = {
  id: true,
  type: true,
  title: true,
  body: true,
  reference_id: true,
  is_read: true,
  created_at: true,
} satisfies Prisma.NotificationSelect;

// Como mucho se devuelven los avisos más recientes
const MAX_AVISOS = 100;

// Asignación implicada en un intercambio, con lo justo para redactar el aviso
type SwapAssignment = {
  id: string;
  due_date: Date;
  due_time: string | null;
  start_minute: number;
  user: { id: string; full_name: string };
  task: { id: string; title: string; apartment_id: string };
};

// La petición tal y como estaba antes de responderla: `from` es del emisor y `to` del receptor
export type SwapNotice = {
  id: string;
  from_assignment: SwapAssignment;
  to_assignment: SwapAssignment;
};

export type TaskAssignedNotice = {
  taskId: string;
  apartmentId: string;
  assignerId: string;
  dueDate: Date;
  dueTime: string;
  assignments: { id: string; user_id: string }[];
};

// due_date se guarda a medianoche UTC: se formatea en UTC para que no cambie de día
const FORMATO_DIA = new Intl.DateTimeFormat('es-ES', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});
const diaCorto = (fecha: Date) => FORMATO_DIA.format(fecha); // "12 nov"

const aMinutos = (hora: string) => {
  const [horas, minutos] = hora.split(':').map(Number);
  return horas * 60 + minutos;
};
const aHora = (minutos: number) =>
  `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`;

// Minuto del día en que empieza una asignación: su hora si la tiene; si no, el minuto heredado
const minutoDeInicio = (asignacion: { due_time: string | null; start_minute: number }) =>
  asignacion.due_time ? aMinutos(asignacion.due_time) : asignacion.start_minute;

// "12 nov · 18:00"
const franja = (asignacion: SwapAssignment) =>
  `${diaCorto(asignacion.due_date)} · ${aHora(minutoDeInicio(asignacion))}`;

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // PA 2248-1: los avisos del usuario en su piso, del más reciente al más antiguo
  async list(apartmentId: string, userId: string, withReminders = true) {
    await this.asegurarMiembro(apartmentId, userId);
    if (withReminders) await this.crearRecordatorios(apartmentId, userId);

    return this.prisma.notification.findMany({
      where: this.delUsuario(apartmentId, userId, withReminders),
      select: AVISO_SELECT,
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: MAX_AVISOS,
    });
  }

  // Contador de avisos sin leer que se enseña en el perfil y en la barra de pestañas
  async unreadCount(apartmentId: string, userId: string, withReminders = true) {
    await this.asegurarMiembro(apartmentId, userId);
    if (withReminders) await this.crearRecordatorios(apartmentId, userId);

    const count = await this.prisma.notification.count({
      where: {
        ...this.delUsuario(apartmentId, userId, withReminders),
        is_read: false,
      },
    });
    return { count };
  }

  // Marca un aviso como leído. El id llega del cliente, así que antes se comprueba en la base
  // de datos que el aviso es de quien hace la petición: si es de otra persona, 403 y no se toca
  async markAsRead(id: string, userId: string) {
    const aviso = await this.prisma.notification.findUnique({
      where: { id },
      select: { user_id: true },
    });
    if (!aviso) {
      throw new NotFoundException('Notificación no encontrada');
    }
    if (aviso.user_id !== userId) {
      throw new ForbiddenException(
        'No puedes modificar una notificación que no es tuya',
      );
    }

    try {
      return await this.prisma.notification.update({
        where: { id },
        data: { is_read: true },
        select: AVISO_SELECT,
      });
    } catch (error) {
      // El aviso se ha borrado entre la comprobación y la escritura
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException('Notificación no encontrada');
      }
      throw error;
    }
  }

  // ─── Avisos que crean las tareas y los intercambios ─────────────────────────────────────

  // Un compañero asigna una tarea: aviso a cada persona asignada, menos a quien la asigna
  async taskAssigned(aviso: TaskAssignedNotice) {
    const destinatarios = aviso.assignments.filter(
      (asignacion) => asignacion.user_id !== aviso.assignerId,
    );
    if (destinatarios.length === 0) return;

    await this.sinInterrumpir('avisar de la tarea asignada', async () => {
      const [tarea, quienAsigna] = await Promise.all([
        this.prisma.task.findUnique({
          where: { id: aviso.taskId },
          select: { title: true },
        }),
        this.prisma.user.findUnique({
          where: { id: aviso.assignerId },
          select: { full_name: true },
        }),
      ]);
      if (!tarea) return;

      const nombre = quienAsigna?.full_name ?? 'Un compañero';
      await this.prisma.notification.createMany({
        data: destinatarios.map((asignacion) => ({
          user_id: asignacion.user_id,
          apartment_id: aviso.apartmentId,
          type: NotificationType.task_assigned,
          title: 'Nueva tarea asignada',
          body: `${nombre} te ha asignado «${tarea.title}» para el ${diaCorto(aviso.dueDate)} a las ${aviso.dueTime}.`,
          reference_id: aviso.taskId,
          assignment_id: asignacion.id,
        })),
      });
    });
  }

  // Un compañero pide un intercambio: aviso a quien tiene que responder
  async swapRequested(swap: SwapNotice) {
    const { from_assignment: ofrecida, to_assignment: pedida } = swap;
    await this.sinInterrumpir('avisar de la solicitud de intercambio', () =>
      this.prisma.notification.create({
        data: {
          user_id: pedida.user.id,
          apartment_id: pedida.task.apartment_id,
          type: NotificationType.swap_requested,
          title: 'Solicitud de intercambio',
          body: `${ofrecida.user.full_name} te propone cambiar su «${ofrecida.task.title}» (${franja(ofrecida)}) por tu «${pedida.task.title}» (${franja(pedida)}).`,
          reference_id: swap.id,
        },
      }),
    );
  }

  // El receptor acepta: aviso al emisor. La solicitud queda atendida para el receptor y los
  // recordatorios de las dos tareas se retiran, porque han cambiado de dueño (cada uno
  // recibirá el de su tarea nueva la próxima vez que consulte sus avisos)
  async swapAccepted(swap: SwapNotice) {
    const { from_assignment: ofrecida, to_assignment: pedida } = swap;
    await this.sinInterrumpir('avisar del intercambio aceptado', () =>
      this.prisma.$transaction([
        this.prisma.notification.create({
          data: {
            user_id: ofrecida.user.id,
            apartment_id: ofrecida.task.apartment_id,
            type: NotificationType.swap_accepted,
            title: 'Intercambio aceptado',
            body: `${pedida.user.full_name} ha aceptado el intercambio: ahora te toca «${pedida.task.title}» (${franja(pedida)}) en lugar de «${ofrecida.task.title}».`,
            reference_id: swap.id,
          },
        }),
        this.solicitudAtendida(swap),
        this.prisma.notification.deleteMany({
          where: {
            type: NotificationType.task_due_soon,
            assignment_id: { in: [ofrecida.id, pedida.id] },
          },
        }),
      ]),
    );
  }

  // El receptor rechaza: aviso al emisor. La petición se borra, así que el aviso lleva a la
  // tarea que ofrecía, que sigue siendo suya
  async swapRejected(swap: SwapNotice) {
    const { from_assignment: ofrecida, to_assignment: pedida } = swap;
    await this.sinInterrumpir('avisar del intercambio rechazado', () =>
      this.prisma.$transaction([
        this.prisma.notification.create({
          data: {
            user_id: ofrecida.user.id,
            apartment_id: ofrecida.task.apartment_id,
            type: NotificationType.swap_rejected,
            title: 'Intercambio rechazado',
            body: `${pedida.user.full_name} ha rechazado cambiar su «${pedida.task.title}» por tu «${ofrecida.task.title}». Tu tarea sigue siendo tuya.`,
            reference_id: ofrecida.task.id,
          },
        }),
        this.solicitudAtendida(swap),
      ]),
    );
  }

  // El emisor cancela su petición: el aviso que recibió el compañero deja de tener sentido
  async swapCancelled(swapRequestId: string) {
    await this.sinInterrumpir('retirar el aviso de la solicitud cancelada', () =>
      this.prisma.notification.deleteMany({
        where: {
          type: NotificationType.swap_requested,
          reference_id: swapRequestId,
        },
      }),
    );
  }

  // ─── helpers ────────────────────────────────────────────────────────────────────────────

  // El receptor ya ha respondido a la petición (aunque lo haya hecho desde la pantalla de
  // intercambios y no desde el aviso): su aviso de solicitud no puede seguir como pendiente
  private solicitudAtendida(swap: SwapNotice) {
    return this.prisma.notification.updateMany({
      where: {
        user_id: swap.to_assignment.user.id,
        type: NotificationType.swap_requested,
        reference_id: swap.id,
      },
      data: { is_read: true },
    });
  }

  // Siempre por usuario y por piso: un aviso de otra persona o de otro hogar nunca sale
  private delUsuario(
    apartmentId: string,
    userId: string,
    withReminders: boolean,
  ): Prisma.NotificationWhereInput {
    return {
      user_id: userId,
      apartment_id: apartmentId,
      ...(withReminders
        ? {}
        : { type: { not: NotificationType.task_due_soon } }),
    };
  }

  private async asegurarMiembro(apartmentId: string, userId: string) {
    const miembro = await this.prisma.userApartment.findUnique({
      where: {
        user_id_apartment_id: { user_id: userId, apartment_id: apartmentId },
      },
      select: { user_id: true },
    });

    if (!miembro) {
      throw new ForbiddenException('No perteneces a este piso');
    }
  }

  // Recordatorios de vencimiento. No hay ningún proceso programado: se crean aquí, al
  // consultar los avisos, para las tareas del usuario que empiezan en las próximas 24 horas.
  // La restricción única (user_id, type, assignment_id) junto con skipDuplicates hace que cada
  // tarea avise una sola vez, aunque lleguen dos consultas a la vez
  private async crearRecordatorios(apartmentId: string, userId: string) {
    await this.sinInterrumpir('crear los recordatorios de vencimiento', async () => {
      const ahora = this.ahoraEnCasa();
      const asignaciones = await this.prisma.taskAssignment.findMany({
        where: {
          user_id: userId,
          task: { apartment_id: apartmentId },
          status: {
            notIn: [AssignmentStatus.completed, AssignmentStatus.rejected],
          },
          due_date: {
            in: [
              new Date(`${ahora.hoy}T00:00:00.000Z`),
              new Date(`${ahora.manana}T00:00:00.000Z`),
            ],
          },
        },
        select: {
          id: true,
          due_date: true,
          due_time: true,
          start_minute: true,
          task: { select: { id: true, title: true } },
        },
      });

      const recordatorios = asignaciones.flatMap((asignacion) => {
        const dia = asignacion.due_date.toISOString().slice(0, 10);
        const inicio = minutoDeInicio(asignacion);
        // Dentro de las próximas 24 horas: lo que queda de hoy, o mañana hasta esta misma hora
        const cuando =
          dia === ahora.hoy && inicio >= ahora.minuto
            ? 'hoy'
            : dia === ahora.manana && inicio <= ahora.minuto
              ? 'mañana'
              : null;
        if (!cuando) return [];
        return [
          {
            user_id: userId,
            apartment_id: apartmentId,
            type: NotificationType.task_due_soon,
            title: 'Tarea próxima a vencer',
            body: `«${asignacion.task.title}» vence ${cuando} a las ${aHora(inicio)}.`,
            reference_id: asignacion.task.id,
            assignment_id: asignacion.id,
          },
        ];
      });
      if (recordatorios.length === 0) return;

      await this.prisma.notification.createMany({
        data: recordatorios,
        skipDuplicates: true,
      });
    });
  }

  // Día y minuto actuales en la zona horaria de la casa, la misma que usa el calendario: las
  // horas de las tareas están en esa hora local
  private ahoraEnCasa() {
    const timeZone = process.env.CALENDAR_TIME_ZONE ?? 'Europe/Madrid';
    const ahora = new Date();
    const hoy = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(ahora);
    const partes = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(ahora);
    const parte = (tipo: string) =>
      Number(partes.find((p) => p.type === tipo)?.value);

    const manana = new Date(`${hoy}T00:00:00.000Z`);
    manana.setUTCDate(manana.getUTCDate() + 1);

    return {
      hoy,
      manana: manana.toISOString().slice(0, 10),
      minuto: parte('hour') * 60 + parte('minute'),
    };
  }

  // Un aviso que no se puede guardar no debe impedir la acción que lo origina (asignar una
  // tarea, responder a un intercambio, abrir la lista…): se registra el fallo y se sigue
  private async sinInterrumpir(accion: string, guardar: () => PromiseLike<unknown>) {
    try {
      await guardar();
    } catch (error) {
      const motivo = error instanceof Error ? error.message : 'error desconocido';
      this.logger.warn(`No se ha podido ${accion}: ${motivo}`);
    }
  }
}

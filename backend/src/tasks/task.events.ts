// Eventos de dominio de las tareas (patrón Observer). TasksService y TaskSwapsService son los
// sujetos: cuando pasa algo lo anuncian con EventEmitter2.emitAsync(NOMBRE, new Evento(...)) y
// no saben quién escucha. Hoy el único observador es NotificationsListener, que crea los avisos
// de UT1019; otro efecto (correo, push…) sería otro listener, sin tocar estos servicios.

// Asignación implicada en un intercambio, con lo justo para redactar el aviso
export type SwapAssignment = {
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

// Un compañero asigna una tarea a una o varias personas
export const TAREA_ASIGNADA = 'tarea.asignada';
export class TareaAsignada {
  constructor(readonly asignacion: TaskAssignedNotice) {}
}

// Alguien pide cambiar su tarea por la de un compañero
export const INTERCAMBIO_SOLICITADO = 'intercambio.solicitado';
export class IntercambioSolicitado {
  constructor(readonly peticion: SwapNotice) {}
}

// El receptor acepta el intercambio (las tareas ya han cambiado de dueño)
export const INTERCAMBIO_ACEPTADO = 'intercambio.aceptado';
export class IntercambioAceptado {
  constructor(readonly peticion: SwapNotice) {}
}

// El receptor lo rechaza (la petición ya se ha borrado)
export const INTERCAMBIO_RECHAZADO = 'intercambio.rechazado';
export class IntercambioRechazado {
  constructor(readonly peticion: SwapNotice) {}
}

// El emisor cancela su propia petición (ya se ha borrado)
export const INTERCAMBIO_CANCELADO = 'intercambio.cancelado';
export class IntercambioCancelado {
  constructor(readonly peticionId: string) {}
}

// Verificación de tareas (UT1021): `ownerId` es quien hizo la tarea y `verifierId` quien tiene
// que confirmarla
export type VerificationNotice = {
  assignmentId: string;
  taskId: string;
  taskTitle: string;
  apartmentId: string;
  ownerId: string;
  verifierId: string;
  // Solo en VERIFICACION_SOLICITADA: el verificador anterior no respondió a tiempo
  reassigned?: boolean;
  // Solo en VERIFICACION_RECHAZADA: el motivo que escribió el verificador
  reason?: string;
  // Solo en VERIFICACION_CONFIRMADA: los puntos que ha ganado quien hizo la tarea
  points?: number;
};

// Una tarea pasa a esperar verificación, o se reasigna a otro verificador por plazo vencido
export const VERIFICACION_SOLICITADA = 'verificacion.solicitada';
export class VerificacionSolicitada {
  constructor(readonly aviso: VerificationNotice) {}
}

// El verificador confirma la tarea: queda completada y su responsable gana los puntos
export const VERIFICACION_CONFIRMADA = 'verificacion.confirmada';
export class VerificacionConfirmada {
  constructor(readonly aviso: VerificationNotice) {}
}

// El verificador rechaza la tarea y vuelve a su responsable
export const VERIFICACION_RECHAZADA = 'verificacion.rechazada';
export class VerificacionRechazada {
  constructor(readonly aviso: VerificationNotice) {}
}

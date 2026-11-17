// Completar una asignación no recibe datos: los puntos salen siempre de la tarea. Al ser un DTO
// vacío, el ValidationPipe (forbidNonWhitelisted) rechaza con 400 cualquier campo que llegue en
// el cuerpo, como `points` o `user_id`, en vez de ignorarlo en silencio.
export class CompleteAssignmentDto {}

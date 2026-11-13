import { Matches } from 'class-validator';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class CreateSwapRequestDto {
  // Tarea propia (del emisor) que se ofrece a cambio.
  @Matches(UUID_REGEX, { message: 'from_assignment_id must be a UUID' })
  from_assignment_id: string;

  // Tarea del compañero que el emisor quiere recibir.
  @Matches(UUID_REGEX, { message: 'to_assignment_id must be a UUID' })
  to_assignment_id: string;
}

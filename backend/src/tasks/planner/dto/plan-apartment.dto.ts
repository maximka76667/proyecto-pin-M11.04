import { IsUUID } from 'class-validator';

// POST /tasks/plan/apply
export class PlanApartmentDto {
  @IsUUID()
  apartment_id: string;
}

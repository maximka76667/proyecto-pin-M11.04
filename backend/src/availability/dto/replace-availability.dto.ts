import { Type } from 'class-transformer';
import {
    ArrayMaxSize,
    IsArray,
    IsIn,
    IsOptional,
    IsString,
    Matches,
    MaxLength,
    ValidateNested,
} from 'class-validator';

export const DAYS = [
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
    'sunday',
] as const;
export type Day = (typeof DAYS)[number];

// "HH:mm"; el fin puede ser "24:00" (medianoche)
const HORA = /^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/;

export class AvailabilityBlockDto {
    @IsIn(DAYS)
    day_of_week: Day;

    @Matches(HORA, { message: 'start must be HH:mm' })
    start: string;

    @Matches(HORA, { message: 'end must be HH:mm' })
    end: string;

    @IsOptional()
    @IsString()
    @MaxLength(60)
    label?: string;
}

export class ReplaceAvailabilityDto {
    @IsArray()
    @ArrayMaxSize(70)
    @ValidateNested({ each: true })
    @Type(() => AvailabilityBlockDto)
    blocks: AvailabilityBlockDto[];
}

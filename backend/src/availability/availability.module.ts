import { Module } from '@nestjs/common';
import { AvailabilityController } from './availability.controller';
import { AvailabilityService } from './availability.service';
import { GoogleCalendarService } from './google-calendar.service';

@Module({
    controllers: [AvailabilityController],
    providers: [AvailabilityService, GoogleCalendarService],
})
export class AvailabilityModule { }

import { BadRequestException, Body, Controller, Get, Param, Put, Query, Post, Delete, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../common/current-user.decorator';
import { AvailabilityService } from './availability.service';
import { ReplaceAvailabilityDto } from './dto/replace-availability.dto';
import { GoogleCalendarService } from './google-calendar.service';

@Controller('availability')
export class AvailabilityController {
    constructor(private readonly availabilityService: AvailabilityService, private readonly googleCalendar: GoogleCalendarService) { }

    @Get('me')
    getMine(@CurrentUser() userId: string) {
        return this.availabilityService.getMine(userId);
    }

    @Put('me')
    replaceMine(@CurrentUser() userId: string, @Body() dto: ReplaceAvailabilityDto) {
        return this.availabilityService.replaceMine(userId, dto);
    }

    @Get('apartment/:id')
    getHousehold(@Param('id') id: string, @CurrentUser() userId: string) {
        // Regex permisiva: los ids de seed no son UUID estrictos
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
            throw new BadRequestException('Validation failed (uuid is expected)');
        }
        return this.availabilityService.getHousehold(id, userId);
    }

    @Get('calendar')
    getCalendar(@Query('apartment_id') apartmentId: string, @Query('from') from: string, @Query('to') to: string, @CurrentUser() userId: string) {
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(apartmentId ?? '')) {
            throw new BadRequestException('Validation failed (apartment_id must be a UUID)');
        }
        return this.availabilityService.getCalendar(apartmentId, userId, from, to);
    }

    @Get('google/status')
    googleStatus(@CurrentUser() userId: string) { return this.googleCalendar.status(userId); }

    @Get('google/connect')
    googleConnect(@CurrentUser() userId: string) { return this.googleCalendar.authorizationUrl(userId); }

    @Get('google/callback')
    async googleCallback(@Query('code') code: string, @Query('state') state: string, @Res() response: Response) {
        try {
            await this.googleCalendar.completeAuthorization(code, state);
            response.redirect(`${process.env.GOOGLE_APP_CALLBACK_URI ?? 'frontend://calendar/google-callback'}?connected=1`);
        } catch {
            response.redirect(`${process.env.GOOGLE_APP_CALLBACK_URI ?? 'frontend://calendar/google-callback'}?connected=0`);
        }
    }

    @Post('google/sync')
    syncGoogle(@CurrentUser() userId: string, @Body() body: { from: string; to: string }) {
        return this.googleCalendar.sync(userId, body.from, body.to);
    }

    @Get('google/events')
    myGoogleEvents(@CurrentUser() userId: string, @Query('from') from: string, @Query('to') to: string) {
        return this.googleCalendar.getMyEvents(userId, from, to);
    }

    @Delete('google')
    disconnectGoogle(@CurrentUser() userId: string) { return this.googleCalendar.disconnect(userId); }
}

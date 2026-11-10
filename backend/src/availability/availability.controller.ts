import { BadRequestException, Body, Controller, Get, Param, Put, Query, Post, Delete, Res, Headers, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../common/current-user.decorator';
import { AvailabilityService } from './availability.service';
import { ReplaceAvailabilityDto } from './dto/replace-availability.dto';
import { GoogleCalendarService } from './google-calendar.service';

@Controller('availability')
export class AvailabilityController {
    private readonly logger = new Logger(AvailabilityController.name);

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
    googleConnect(@CurrentUser() userId: string, @Query('platform') platform?: string, @Headers('origin') origin?: string) {
        return this.googleCalendar.authorizationUrl(userId, platform === 'web' ? origin : undefined);
    }

    @Get('google/callback')
    async googleCallback(@Query('code') code: string, @Query('state') state: string, @Query('error') oauthError: string, @Res() response: Response) {
        const callbackUri = this.googleCalendar.callbackUriFromState(state);
        try {
            if (oauthError || !code) throw new BadRequestException(oauthError ?? 'Google did not return an authorization code');
            await this.googleCalendar.completeAuthorization(code, state);
            response.redirect(this.googleCallbackUrl(callbackUri, '1'));
        } catch (error) {
            this.logger.warn(`Google Calendar authorization failed: ${error instanceof Error ? error.message : 'unknown error'}`);
            response.redirect(this.googleCallbackUrl(callbackUri, '0'));
        }
    }

    private googleCallbackUrl(callbackUri: string, connected: '0' | '1') {
        const callback = new URL(callbackUri);
        callback.searchParams.set('connected', connected);
        return callback.toString();
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

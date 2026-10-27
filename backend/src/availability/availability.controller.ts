import { BadRequestException, Body, Controller, Get, Param, Put } from '@nestjs/common';
import { CurrentUser } from '../common/current-user.decorator';
import { AvailabilityService } from './availability.service';
import { ReplaceAvailabilityDto } from './dto/replace-availability.dto';

@Controller('availability')
export class AvailabilityController {
    constructor(private readonly availabilityService: AvailabilityService) { }

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
}

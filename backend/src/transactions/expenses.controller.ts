import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../common/current-user.decorator';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { ExpensesService } from './expenses.service';

@Controller()
export class ExpensesController {
  constructor(private readonly expensesService: ExpensesService) {}

  // Lo más reciente primero, con los productos de cada ticket agrupados bajo él
  @Get('expenses')
  list(
    @Query('apartment_id') apartmentId: string | undefined,
    @CurrentUser() userId: string,
  ) {
    return this.expensesService.list(apartmentId, userId);
  }

  @Patch('expenses/:id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateExpenseDto,
    @CurrentUser() userId: string,
  ) {
    return this.expensesService.update(id, dto, userId);
  }

  // La versión que el cliente cargó va en la query: DELETE no lleva cuerpo de forma fiable
  @Delete('expenses/:id')
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('version', ParseIntPipe) version: number,
    @CurrentUser() userId: string,
  ) {
    return this.expensesService.remove(id, version, userId);
  }

  @Delete('receipts/:id')
  removeReceipt(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('version', ParseIntPipe) version: number,
    @CurrentUser() userId: string,
  ) {
    return this.expensesService.removeReceipt(id, version, userId);
  }
}

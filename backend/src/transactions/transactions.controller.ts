import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  ParseUUIDPipe,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../common/current-user.decorator';
import { TransactionsService } from './transactions.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { SettleDebtDto } from './dto/settle-debt.dto';
import { UpdateTransactionDto } from './dto/update-transaction.dto';

@Controller('transactions')
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Post()
  create(@Body() createTransactionDto: CreateTransactionDto) {
    return this.transactionsService.create(createTransactionDto);
  }

  @Get()
  findAll(@Query('apartment_id') apartmentId?: string) {
    return this.transactionsService.findAll(apartmentId);
  }

  @Get('public-balance/:inviteCode')
  getPublicApartmentBalance(@Param('inviteCode') inviteCode: string) {
    return this.transactionsService.getPublicApartmentBalance(inviteCode);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.transactionsService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateTransactionDto: UpdateTransactionDto,
  ) {
    return this.transactionsService.update(id, updateTransactionDto);
  }

  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.transactionsService.remove(id);
  }

  

  @Get(':apartmentId/my-summary')
  getMyPersonalSummary(
    @Param('apartmentId') apartmentId: string,
    @CurrentUser() userId: string,
  ) {
    return this.transactionsService.getPersonalSummary(apartmentId, userId);
  }

  @Get(':apartmentId/settle-up')
  getSettleUp(
    @Param('apartmentId') apartmentId: string,
    @CurrentUser() userId: string,
  ) {
    return this.transactionsService.getSettleUp(apartmentId, userId);
  }

  // El deudor avisa de que ha pagado
  @Post(':apartmentId/settle')
  markAsPaid(
    @Param('apartmentId') apartmentId: string,
    @Body() settleDebtDto: SettleDebtDto,
    @CurrentUser() userId: string,
  ) {
    return this.transactionsService.markAsPaid(
      apartmentId,
      userId,
      settleDebtDto,
    );
  }

  // El acreedor confirma que ha recibido el pago
  @Post(':id/confirm')
  confirmPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() userId: string,
  ) {
    return this.transactionsService.confirmPayment(id, userId);
  }

  // El acreedor indica que el pago no le ha llegado
  @Post(':id/reject')
  rejectPayment(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() userId: string,
  ) {
    return this.transactionsService.rejectPayment(id, userId);
  }
}

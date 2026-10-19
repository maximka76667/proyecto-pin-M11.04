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
    getMyPersonalSummary(@Param('apartmentId') apartmentId: string) {
    const usuarioLogueadoId = '11111111-1111-1111-1111-111111111111';

    return this.transactionsService.getPersonalSummary(
      apartmentId,
      usuarioLogueadoId,
    );
  }

  @Get(':apartmentId/settle-up')
  getSettleUp(@Param('apartmentId') apartmentId: string) {
    return this.transactionsService.getSettleUp(apartmentId);
  }

  @Post(':apartmentId/settle')
  settleDebt(
    @Param('apartmentId') apartmentId: string,
    @Body() settleDebtDto: SettleDebtDto,
  ) {
    const usuarioLogueadoId = '11111111-1111-1111-1111-111111111111';

    return this.transactionsService.settleDebt(apartmentId, usuarioLogueadoId, settleDebtDto);
  }
}

import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { TransactionsService } from './transactions.service';
import { TransactionsController } from './transactions.controller';
import { ExpensesController } from './expenses.controller';
import { ExpensesService } from './expenses.service';

@Module({
  imports: [UsersModule],
  controllers: [TransactionsController, ExpensesController],
  providers: [TransactionsService, ExpensesService],
})
export class TransactionsModule {}

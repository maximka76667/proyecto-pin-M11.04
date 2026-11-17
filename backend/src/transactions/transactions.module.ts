import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { TransactionsService } from './transactions.service';
import { TransactionsController } from './transactions.controller';
import { ExpensesController } from './expenses.controller';
import { ExpensesService } from './expenses.service';

@Module({
  // NotificationsService: avisa de los gastos y de los pagos (UT1018)
  imports: [UsersModule, NotificationsModule],
  controllers: [TransactionsController, ExpensesController],
  providers: [TransactionsService, ExpensesService],
})
export class TransactionsModule {}

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TransactionCategory } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { SettleDebtDto } from './dto/settle-debt.dto';
import { UpdateTransactionDto } from './dto/update-transaction.dto';

export interface BalanceUsuario {
  userId: string;
  balanceNeto: number;
}

export interface Pago {
  deudorId: string;
  acreedorId: string;
  monto: number;
}

export interface RespuestaMiBalancePersonal {
  globalPayments: {
    deudor: string;
    acreedor: string;
    monto: number;
  }[];
  miResumen: {
    esDeudor: boolean;
    monto: number;
    conceptos: string[];
  };
  mensaje: string;
}

export interface DeudaSettleUp {
  deudorId: string;
  deudor: string;
  acreedorId: string;
  acreedor: string;
  monto: number;
}

@Injectable()
export class TransactionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
  ) {}

  async create(createTransactionDto: CreateTransactionDto) {
    const debtorIds = createTransactionDto.to_user_ids?.length
      ? Array.from(new Set(createTransactionDto.to_user_ids))
      : createTransactionDto.to_user_id
        ? [createTransactionDto.to_user_id]
        : [];

    if (debtorIds.length === 0) {
      throw new BadRequestException('At least one debtor must be specified');
    }

    if (debtorIds.includes(createTransactionDto.from_user_id)) {
      throw new BadRequestException('The payer and the debtor must be different');
    }

    try {
      if (debtorIds.length === 1) {
        return await this.prisma.transaction.create({
          data: {
            apartment_id: createTransactionDto.apartment_id,
            from_user_id: createTransactionDto.from_user_id,
            to_user_id: debtorIds[0],
            amount: createTransactionDto.amount,
            concept: createTransactionDto.concept,
            category: createTransactionDto.category,
          },
        });
      }

      // Split total amount among debtors equally (using cents to handle exact rounding)
      const totalAmount = Number(createTransactionDto.amount);
      const totalCents = Math.round(totalAmount * 100);
      const baseCents = Math.floor(totalCents / debtorIds.length);
      const remainder = totalCents % debtorIds.length;

      const creates = debtorIds.map((debtorId, index) => {
        const shareCents = baseCents + (index < remainder ? 1 : 0);
        const shareAmount = (shareCents / 100).toFixed(2);

        return this.prisma.transaction.create({
          data: {
            apartment_id: createTransactionDto.apartment_id,
            from_user_id: createTransactionDto.from_user_id,
            to_user_id: debtorId,
            amount: shareAmount,
            concept: createTransactionDto.concept,
            category: createTransactionDto.category,
          },
        });
      });

      if (typeof (this.prisma as unknown as { $transaction?: unknown }).$transaction === 'function') {
        return await this.prisma.$transaction(creates);
      }
      return await Promise.all(creates);
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  findAll(apartmentId?: string) {
    return this.prisma.transaction.findMany({
      where: apartmentId ? { apartment_id: apartmentId } : undefined,
      include: {
        apartment: true,
        fromUser: true,
        toUser: true,
      },
    });
  }

  async findOne(id: string) {
    const transaction = await this.prisma.transaction.findUnique({
      where: { id },
      include: {
        apartment: true,
        fromUser: true,
        toUser: true,
      },
    });

    if (!transaction) {
      throw new NotFoundException('Transaction not found');
    }

    return transaction;
  }

  async update(id: string, updateTransactionDto: UpdateTransactionDto) {
    try {
      return await this.prisma.transaction.update({
        where: { id },
        data: updateTransactionDto,
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  async remove(id: string) {
    try {
      return await this.prisma.transaction.delete({
        where: { id },
      });
    } catch (error) {
      this.handlePrismaError(error);
    }
  }

  private handlePrismaError(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2025') {
        throw new NotFoundException('Transaction not found');
      }
      if (error.code === 'P2003') {
        throw new BadRequestException('Apartment or user not found');
      }
    }
    throw error;
  }

  async getPagoMinimo(apartmentId: string): Promise<Pago[]> {
    const allBalances = await this.calcularAllBalances(apartmentId);
    const Pagos = this.calcularMinimosPagos(allBalances);

    return Pagos;
  }

  async getPersonalSummary(
    apartmentId: string,
    userId: string,
  ): Promise<RespuestaMiBalancePersonal> {
    const allPayments = await this.getPagoMinimo(apartmentId);
    const userNames = await this.usersService.getUserNames(
      allPayments.flatMap((payment) => [payment.deudorId, payment.acreedorId]),
    );

    const debtsAsDebtor = allPayments.filter(
      (payment) => payment.deudorId === userId,
    );
    const debtsAsCreditor = allPayments.filter(
      (payment) => payment.acreedorId === userId,
    );

    let mensaje = 'Estás al día en tus pagos.';
    let esDeudor = false;
    let monto = 0;
    let conceptos: string[] = [];

    if (debtsAsDebtor.length > 0) {
      esDeudor = true;
      monto = debtsAsDebtor.reduce((sum, payment) => sum + payment.monto, 0);
      conceptos = debtsAsDebtor.map(
        (payment) =>
          `Debes ${payment.monto}€ a ${
            userNames[payment.acreedorId] ?? payment.acreedorId
          }`,
      );
      mensaje = `En total, debes ${monto.toFixed(2)}€ para saldar cuentas.`;
    } else if (debtsAsCreditor.length > 0) {
      monto = debtsAsCreditor.reduce((sum, payment) => sum + payment.monto, 0);
      conceptos = debtsAsCreditor.map(
        (payment) =>
          `${userNames[payment.deudorId] ?? payment.deudorId} te debe ${
            payment.monto
          }€`,
      );
      mensaje = `En total, tienes ${monto.toFixed(2)}€ pendientes de cobro.`;
    }

    return {
      globalPayments: allPayments.map((payment) => ({
        deudor: userNames[payment.deudorId] ?? payment.deudorId,
        acreedor: userNames[payment.acreedorId] ?? payment.acreedorId,
        monto: payment.monto,
      })),
      miResumen: {
        esDeudor,
        monto: parseFloat(monto.toFixed(2)),
        conceptos,
      },
      mensaje,
    };
  }

  async getSettleUp(apartmentId: string): Promise<DeudaSettleUp[]> {
    const allPayments = await this.getPagoMinimo(apartmentId);
    const userNames = await this.usersService.getUserNames(
      allPayments.flatMap((payment) => [payment.deudorId, payment.acreedorId]),
    );

    return allPayments.map((payment) => ({
      deudorId: payment.deudorId,
      deudor: userNames[payment.deudorId] ?? payment.deudorId,
      acreedorId: payment.acreedorId,
      acreedor: userNames[payment.acreedorId] ?? payment.acreedorId,
      monto: payment.monto,
    }));
  }

  // Solo el acreedor puede marcar como pagada una deuda que tiene a su favor
  async settleDebt(apartmentId: string, acreedorId: string, settleDebtDto: SettleDebtDto) {
    const allPayments = await this.getPagoMinimo(apartmentId);
    const pago = allPayments.find(
      (payment) =>
        payment.deudorId === settleDebtDto.deudor_id && payment.acreedorId === acreedorId,
    );

    if (!pago) {
      throw new NotFoundException('No hay ninguna deuda pendiente de este usuario contigo');
    }

    if (Math.abs(pago.monto - Number(settleDebtDto.amount)) > 0.01) {
      throw new ConflictException('El balance ha cambiado, recarga la pantalla');
    }

    return this.prisma.transaction.create({
      data: {
        apartment_id: apartmentId,
        from_user_id: pago.deudorId,
        to_user_id: pago.acreedorId,
        amount: pago.monto.toFixed(2),
        category: TransactionCategory.payment,
      },
    });
  }

  async getPublicApartmentBalance(inviteCode: string) {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        inviteCode,
      )
    ) {
      throw new NotFoundException(
        'El código introducido no es válido o ha caducado',
      );
    }

    const apartment = await this.prisma.apartment.findUnique({
      where: { invite_code: inviteCode },
      select: { id: true, name: true },
    });

    if (!apartment) {
      throw new NotFoundException(
        'El código introducido no es válido o ha caducado',
      );
    }

    const payments = await this.getPagoMinimo(apartment.id);
    const userNames = await this.usersService.getUserNames(
      payments.flatMap((payment) => [payment.deudorId, payment.acreedorId]),
    );

    return {
      apartment: { name: apartment.name },
      globalPayments: payments.map((payment) => ({
        deudor: userNames[payment.deudorId] ?? payment.deudorId,
        acreedor: userNames[payment.acreedorId] ?? payment.acreedorId,
        monto: payment.monto,
      })),
    };
  }

  async getSettleUp(apartmentId: string): Promise<DeudaSettleUp[]> {
    const allPayments = await this.getPagoMinimo(apartmentId);
    const userNames = await this.usersService.getUserNames(
      allPayments.flatMap((payment) => [payment.deudorId, payment.acreedorId]),
    );

    return allPayments.map((payment) => ({
      deudorId: payment.deudorId,
      deudor: userNames[payment.deudorId] ?? payment.deudorId,
      acreedorId: payment.acreedorId,
      acreedor: userNames[payment.acreedorId] ?? payment.acreedorId,
      monto: payment.monto,
    }));
  }

  // Solo el acreedor puede marcar como pagada una deuda que tiene a su favor
  async settleDebt(
    apartmentId: string,
    acreedorId: string,
    settleDebtDto: SettleDebtDto,
  ) {
    const allPayments = await this.getPagoMinimo(apartmentId);
    const pago = allPayments.find(
      (payment) =>
        payment.deudorId === settleDebtDto.deudor_id &&
        payment.acreedorId === acreedorId,
    );

    if (!pago) {
      throw new NotFoundException(
        'No hay ninguna deuda pendiente de este usuario contigo',
      );
    }

    if (Math.abs(pago.monto - Number(settleDebtDto.amount)) > 0.01) {
      throw new ConflictException(
        'El balance ha cambiado, recarga la pantalla',
      );
    }

    return this.prisma.transaction.create({
      data: {
        apartment_id: apartmentId,
        from_user_id: pago.deudorId,
        to_user_id: pago.acreedorId,
        amount: pago.monto.toFixed(2),
        category: TransactionCategory.payment,
      },
    });
  }

  private async calcularAllBalances(
    apartmentId: string,
  ): Promise<BalanceUsuario[]> {
    const pagadores = await this.prisma.transaction.findMany({
      where: { apartment_id: apartmentId },
      select: { from_user_id: true },
      distinct: ['from_user_id'],
    });

    const deudores = await this.prisma.transaction.findMany({
      where: { apartment_id: apartmentId },
      select: { to_user_id: true },
      distinct: ['to_user_id'],
    });

    const userIdsSet = new Set<string>();
    pagadores.forEach((t) => userIdsSet.add(t.from_user_id));
    deudores.forEach((t) => userIdsSet.add(t.to_user_id));
    const userIds = Array.from(userIdsSet);

    const balancePromises = userIds.map(async (userId) => {
      const ingresoAgg = await this.prisma.transaction.aggregate({
        _sum: { amount: true },
        where: { apartment_id: apartmentId, from_user_id: userId },
      });

      const gastoAgg = await this.prisma.transaction.aggregate({
        _sum: { amount: true },
        where: { apartment_id: apartmentId, to_user_id: userId },
      });

      const totalPagado = Number(ingresoAgg._sum.amount ?? 0);
      const totalDebido = Number(gastoAgg._sum.amount ?? 0);

      return {
        userId,
        balanceNeto: totalPagado - totalDebido,
      };
    });

    return Promise.all(balancePromises);
  }

  private calcularMinimosPagos(balances: BalanceUsuario[]): Pago[] {
    const acreedores = balances
      .filter((u) => u.balanceNeto > 0.01)
      .map((u) => ({ ...u, montoRestante: u.balanceNeto }));

    const deudores = balances
      .filter((u) => u.balanceNeto < -0.01)
      .map((u) => ({ ...u, montoRestante: Math.abs(u.balanceNeto) }));

    acreedores.sort((a, b) => b.montoRestante - a.montoRestante);
    deudores.sort((a, b) => b.montoRestante - a.montoRestante);

    const pagosFinales: Pago[] = [];
    let iAcr = 0;
    let iDeu = 0;

    while (iAcr < acreedores.length && iDeu < deudores.length) {
      const mayorAcreedor = acreedores[iAcr];
      const mayorDeudor = deudores[iDeu];

      const montoASaldar = Math.min(
        mayorAcreedor.montoRestante,
        mayorDeudor.montoRestante,
      );

      if (montoASaldar > 0.01) {
        pagosFinales.push({
          deudorId: mayorDeudor.userId,
          acreedorId: mayorAcreedor.userId,
          monto: parseFloat(montoASaldar.toFixed(2)),
        });
      }

      mayorAcreedor.montoRestante -= montoASaldar;
      mayorDeudor.montoRestante -= montoASaldar;

      if (mayorAcreedor.montoRestante <= 0.01) {
        iAcr++;
      }
      if (mayorDeudor.montoRestante <= 0.01) {
        iDeu++;
      }
    }

    return pagosFinales;
  }
}

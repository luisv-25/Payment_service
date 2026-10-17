import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { QueryFailedError, Repository } from "typeorm";
import { Transaction, TransactionStatus } from "./entities/transaction.entity";
import { Package } from "../packages/entities/package.entity";
import { Refund } from "../refunds/entities/refund.entity";
import { GatewayClient } from "./gateway.client";
import { CatalogServiceClient } from "./catalog-service.client";
import { EventsPublisher } from "../events/events.publisher";
import { RefundTransactionDto } from "./dto/refund-transaction.dto";

const PLATFORM_COMMISSION_RATE = Number(process.env.PLATFORM_COMMISSION_RATE ?? 0.15);
const POSTGRES_UNIQUE_VIOLATION = "23505";

interface Requester {
  id: string;
  role: string;
}

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);

  constructor(
    @InjectRepository(Transaction) private readonly txRepo: Repository<Transaction>,
    @InjectRepository(Package) private readonly packagesRepo: Repository<Package>,
    @InjectRepository(Refund) private readonly refundsRepo: Repository<Refund>,
    private readonly gatewayClient: GatewayClient,
    private readonly catalogServiceClient: CatalogServiceClient,
    private readonly eventsPublisher: EventsPublisher,
  ) {}

  private splitCommission(amount: number) {
    const commission_amount = Math.round(amount * PLATFORM_COMMISSION_RATE * 100) / 100;
    const tutor_net_amount = Math.round((amount - commission_amount) * 100) / 100;
    return { commission_rate: PLATFORM_COMMISSION_RATE, commission_amount, tutor_net_amount };
  }

  // Reacciona a booking.confirmed (comunicación asíncrona, sección 5.5):
  // cobra la sesión -- de un paquete de horas con saldo si el estudiante
  // tiene uno activo, o como cobro individual si no. gateway_reference es
  // DETERMINÍSTICA (booking-<id>) para que una reentrega del evento por
  // RabbitMQ nunca produzca un segundo cobro: choca contra el UNIQUE de
  // la columna y se ignora.
  async chargeForBookingConfirmed(data: {
    bookingId: string;
    studentId: string;
    tutorProfileId: string;
    priceSnapshot: number;
  }) {
    const existing = await this.txRepo.findOne({ where: { booking_id: data.bookingId } });
    if (existing) {
      this.logger.log(`Ya existe un cobro para booking ${data.bookingId}; evento ignorado (idempotencia)`);
      return existing;
    }

    // booking.tutor_id (en el evento) es tutor_profiles.id, no user.id --
    // se resuelve contra Catalog para que transactions.tutor_id quede
    // consistente con student_id (ambos user_db.users.id directos).
    const tutorProfile = await this.catalogServiceClient.getTutorProfile(data.tutorProfileId);
    const tutorUserId: string | null = tutorProfile?.user?.id ?? null;

    const activePackage = await this.packagesRepo
      .createQueryBuilder("pkg")
      .where("pkg.student_id = :studentId", { studentId: data.studentId })
      .andWhere("pkg.hours_remaining > 0")
      .orderBy("pkg.purchased_at", "ASC")
      .getOne();

    const amount = activePackage ? 0 : Number(data.priceSnapshot);
    const { commission_rate, commission_amount, tutor_net_amount } = this.splitCommission(amount);
    const gatewayReference = `booking-${data.bookingId}`;
    const gatewayResult = this.gatewayClient.charge(gatewayReference);

    let saved: Transaction;
    try {
      saved = await this.txRepo.save(
        this.txRepo.create({
          package_id: activePackage?.id ?? null,
          booking_id: data.bookingId,
          student_id: data.studentId,
          tutor_id: tutorUserId,
          amount,
          status: gatewayResult.succeeded ? TransactionStatus.SUCCEEDED : TransactionStatus.FAILED,
          commission_rate,
          commission_amount,
          tutor_net_amount,
          gateway_reference: gatewayReference,
        }),
      );
    } catch (err) {
      if (err instanceof QueryFailedError && (err.driverError as any)?.code === POSTGRES_UNIQUE_VIOLATION) {
        this.logger.log(`Carrera detectada: cobro para booking ${data.bookingId} ya existía`);
        return this.txRepo.findOne({ where: { booking_id: data.bookingId } });
      }
      throw err;
    }

    if (activePackage) {
      activePackage.hours_remaining -= 1;
      await this.packagesRepo.save(activePackage);
    }

    if (saved.status === TransactionStatus.SUCCEEDED) {
      this.eventsPublisher.publishPaymentSucceeded(saved);
    } else {
      this.eventsPublisher.publishPaymentFailed(saved);
    }
    return saved;
  }

  // Reacciona a booking.cancelled: si la sesión ya se había cobrado,
  // reembolsa automáticamente el total y devuelve la hora consumida al
  // paquete de origen, si aplica. Idempotente: no duplica el reembolso si
  // el evento se reentrega.
  async refundForBookingCancelled(bookingId: string) {
    const transaction = await this.txRepo.findOne({ where: { booking_id: bookingId } });
    if (!transaction || transaction.status !== TransactionStatus.SUCCEEDED) return null;

    const alreadyRefunded = await this.refundsRepo.count({ where: { transaction_id: transaction.id } });
    if (alreadyRefunded > 0) return null;

    const refund = await this.refundsRepo.save(
      this.refundsRepo.create({
        transaction_id: transaction.id,
        amount: transaction.amount,
        reason: "Reserva cancelada",
      }),
    );

    if (transaction.package_id) {
      const pkg = await this.packagesRepo.findOne({ where: { id: transaction.package_id } });
      if (pkg) {
        pkg.hours_remaining += 1;
        await this.packagesRepo.save(pkg);
      }
    }

    this.eventsPublisher.publishPaymentRefunded(transaction, refund);
    return refund;
  }

  // Cobro directo por la compra de un paquete de horas (sección 5.5):
  // siempre es un cobro individual, nunca consume otro paquete. La
  // comisión de plataforma se retiene sobre el cobro de SESIONES (lo que
  // termina pagándose a un tutor en concreto), no sobre la compra del
  // paquete -- en este punto todavía no se sabe con qué tutor(es) se usará.
  async chargePackagePurchase(studentId: string, pkg: Package, amount: number) {
    const gatewayReference = `package-${pkg.id}`;
    const gatewayResult = this.gatewayClient.charge(gatewayReference);
    return this.txRepo.save(
      this.txRepo.create({
        package_id: pkg.id,
        booking_id: null,
        student_id: studentId,
        tutor_id: null,
        amount,
        status: gatewayResult.succeeded ? TransactionStatus.SUCCEEDED : TransactionStatus.FAILED,
        commission_rate: 0,
        commission_amount: 0,
        tutor_net_amount: 0,
        gateway_reference: gatewayReference,
      }),
    );
  }

  async findOne(id: string) {
    const tx = await this.txRepo.findOne({ where: { id } });
    if (!tx) throw new NotFoundException(`Transacción ${id} no encontrada`);
    return tx;
  }

  // Filtra por el rol de quien consulta -- un estudiante o tutor solo ve
  // sus propias transacciones, admin ve todas (mismo criterio de
  // ownership que en el resto de los servicios).
  findAll(filters: { studentId?: string; tutorId?: string; bookingId?: string }, requester: Requester) {
    const where: any = {};
    if (filters.bookingId) where.booking_id = filters.bookingId;

    if (requester.role === "admin") {
      if (filters.studentId) where.student_id = filters.studentId;
      if (filters.tutorId) where.tutor_id = filters.tutorId;
    } else if (requester.role === "student") {
      where.student_id = requester.id;
    } else if (requester.role === "tutor") {
      where.tutor_id = requester.id;
    }
    return this.txRepo.find({ where, order: { created_at: "DESC" } });
  }

  // Reembolso manual (admin): parcial o total. Nunca cambia
  // transactions.status, que solo admite pending/succeeded/failed (sección
  // 5.5) -- el estado del reembolso vive aislado en su propia tabla, tal
  // como justifica la normalización del documento.
  async manualRefund(transactionId: string, dto: RefundTransactionDto, requester: Requester) {
    if (requester.role !== "admin") {
      throw new ForbiddenException("Solo un administrador puede generar reembolsos manuales");
    }
    const transaction = await this.findOne(transactionId);
    if (transaction.status !== TransactionStatus.SUCCEEDED) {
      throw new ConflictException("Solo se puede reembolsar una transacción exitosa");
    }

    const { total } = await this.refundsRepo
      .createQueryBuilder("r")
      .select("COALESCE(SUM(r.amount), 0)", "total")
      .where("r.transaction_id = :id", { id: transactionId })
      .getRawOne<{ total: string }>();
    const refundedSoFar = Number(total ?? 0);
    const remaining = Number(transaction.amount) - refundedSoFar;
    const amount = dto.amount ?? remaining;

    if (remaining <= 0) {
      throw new ConflictException("Esta transacción ya fue reembolsada por completo");
    }
    if (amount <= 0 || amount > remaining + 0.01) {
      throw new ConflictException(`Monto de reembolso inválido; disponible: ${remaining.toFixed(2)}`);
    }

    const refund = await this.refundsRepo.save(
      this.refundsRepo.create({
        transaction_id: transaction.id,
        amount,
        reason: dto.reason ?? "Reembolso manual",
      }),
    );
    this.eventsPublisher.publishPaymentRefunded(transaction, refund);
    return refund;
  }

  listRefunds(transactionId: string) {
    return this.refundsRepo.find({ where: { transaction_id: transactionId }, order: { processed_at: "DESC" } });
  }

  // Liquidación periódica a tutores (sección 5.5): suma lo cobrado en
  // transacciones exitosas de un tutor, neto de comisión y de reembolsos.
  // No hay tabla de liquidaciones persistida (el documento solo define
  // packages/transactions/refunds) -- se calcula al vuelo cada vez que se
  // consulta, como un reporte, igual que la liquidación a cualquier
  // momento es simplemente "lo cobrado hasta ahora menos lo reembolsado".
  async settlementForTutor(tutorId: string) {
    const row = await this.txRepo
      .createQueryBuilder("t")
      .leftJoin(Refund, "r", "r.transaction_id = t.id")
      .select("COUNT(DISTINCT t.id)", "transactionsCount")
      .addSelect("COALESCE(SUM(t.amount), 0)", "grossAmount")
      .addSelect("COALESCE(SUM(t.commission_amount), 0)", "commissionRetained")
      .addSelect("COALESCE(SUM(t.tutor_net_amount), 0)", "tutorNetBeforeRefunds")
      .addSelect("COALESCE(SUM(r.amount), 0)", "refundedAmount")
      .where("t.tutor_id = :tutorId", { tutorId })
      .andWhere("t.status = :status", { status: TransactionStatus.SUCCEEDED })
      .getRawOne();

    const tutorNetBeforeRefunds = Number(row.tutorNetBeforeRefunds);
    const refundedAmount = Number(row.refundedAmount);
    return {
      tutorId,
      transactionsCount: Number(row.transactionsCount),
      grossAmount: Number(row.grossAmount),
      commissionRetained: Number(row.commissionRetained),
      refundedAmount,
      netPayable: Math.max(0, tutorNetBeforeRefunds - refundedAmount),
    };
  }

  // Panel admin: liquidación de TODOS los tutores con cobros exitosos.
  async settlementSummary() {
    const rows = await this.txRepo
      .createQueryBuilder("t")
      .select("t.tutor_id", "tutorId")
      .addSelect("COUNT(*)", "transactionsCount")
      .addSelect("COALESCE(SUM(t.amount), 0)", "grossAmount")
      .addSelect("COALESCE(SUM(t.commission_amount), 0)", "commissionRetained")
      .addSelect("COALESCE(SUM(t.tutor_net_amount), 0)", "netPayable")
      .where("t.status = :status", { status: TransactionStatus.SUCCEEDED })
      .andWhere("t.tutor_id IS NOT NULL")
      .groupBy("t.tutor_id")
      .getRawMany();

    return rows.map((r) => ({
      tutorId: r.tutorId,
      transactionsCount: Number(r.transactionsCount),
      grossAmount: Number(r.grossAmount),
      commissionRetained: Number(r.commissionRetained),
      netPayable: Number(r.netPayable),
    }));
  }
}

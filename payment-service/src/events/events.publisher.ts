import { Inject, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ClientProxy } from "@nestjs/microservices";
import { Transaction } from "../transactions/entities/transaction.entity";
import { Refund } from "../refunds/entities/refund.entity";

// Estos eventos (payment.succeeded/failed/refunded) no tienen consumidor
// en esta entrega, pero se publican siguiendo el mismo criterio que
// session.room.ready en session-service: documentan el contrato de
// integración de la sección 5.5 para que otro servicio (p. ej. una futura
// notificación al tutor) pueda suscribirse sin tocar Payment Service.
@Injectable()
export class EventsPublisher implements OnModuleInit {
  private readonly logger = new Logger(EventsPublisher.name);

  constructor(@Inject("PAYMENT_EVENTS_CLIENT") private readonly client: ClientProxy) {}

  async onModuleInit() {
    await this.client.connect();
  }

  private emit(eventName: string, data: Record<string, unknown>) {
    this.logger.log(`Publicando ${eventName}`);
    return this.client.emit(eventName, {
      eventName,
      occurredAt: new Date().toISOString(),
      data,
    });
  }

  publishPaymentSucceeded(transaction: Transaction) {
    return this.emit("payment.succeeded", {
      transactionId: transaction.id,
      bookingId: transaction.booking_id,
      packageId: transaction.package_id,
      studentId: transaction.student_id,
      tutorId: transaction.tutor_id,
      amount: transaction.amount,
      tutorNetAmount: transaction.tutor_net_amount,
    });
  }

  publishPaymentFailed(transaction: Transaction) {
    return this.emit("payment.failed", {
      transactionId: transaction.id,
      bookingId: transaction.booking_id,
      studentId: transaction.student_id,
    });
  }

  publishPaymentRefunded(transaction: Transaction, refund: Refund) {
    return this.emit("payment.refunded", {
      transactionId: transaction.id,
      refundId: refund.id,
      bookingId: transaction.booking_id,
      amount: refund.amount,
    });
  }
}

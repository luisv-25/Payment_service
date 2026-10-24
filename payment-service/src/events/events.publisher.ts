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

  constructor(
    @Inject("PAYMENT_EVENTS_CLIENT") private readonly client: ClientProxy,
    @Inject("NOTIFICATION_EVENTS_CLIENT") private readonly notificationClient: ClientProxy,
    @Inject("ANALYTICS_EVENTS_CLIENT") private readonly analyticsClient: ClientProxy,
  ) {}

  async onModuleInit() {
    await this.client.connect();
    await this.notificationClient.connect();
    await this.analyticsClient.connect();
  }

  private emit(eventName: string, data: Record<string, unknown>) {
  this.logger.log(`Publicando ${eventName}`);
  const payload = {
    eventName,
    occurredAt: new Date().toISOString(),
    data,
  };
  this.client.emit(eventName, payload);
  return this.analyticsClient.emit(eventName, payload);
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

  // "Alertas de renovación de paquete de horas" (sección 5.8 del
  // documento de Notification Service). Va a su propia cola dedicada
  // (notification_events_queue), no a payment_events_queue -- ningún
  // consumidor de payment_events_queue existe todavía, pero mezclar aquí
  // un evento que SÍ tiene consumidor (notification-service) con los que
  // todavía no lo tienen habría sido confuso.
  publishPackageLowBalance(data: {
    packageId: string;
    studentId: string;
    hoursRemaining: number;
    triggeredByBookingId: string;
  }) {
    this.logger.log(`Publicando package.low_balance para paquete ${data.packageId}`);
    return this.notificationClient.emit("package.low_balance", {
      eventName: "package.low_balance",
      occurredAt: new Date().toISOString(),
      data,
    });
  }
}

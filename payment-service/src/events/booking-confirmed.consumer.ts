import { Controller, Inject, Logger, forwardRef } from "@nestjs/common";
import { Ctx, EventPattern, Payload, RmqContext } from "@nestjs/microservices";
import { TransactionsService } from "../transactions/transactions.service";

interface BookingConfirmedEvent {
  eventName: string;
  occurredAt: string;
  data: {
    bookingId: string;
    studentId: string;
    tutorId: string; // tutor_profiles.id -- se resuelve a user.id dentro del service
    priceSnapshot: number;
  };
}

@Controller()
export class BookingConfirmedConsumer {
  private readonly logger = new Logger(BookingConfirmedConsumer.name);

  constructor(
    @Inject(forwardRef(() => TransactionsService))
    private readonly transactionsService: TransactionsService,
  ) {}

  // Comunicación ASÍNCRONA: Payment reacciona a booking.confirmed cobrando
  // la sesión (sección 5.5 del documento de arquitectura). Igual que
  // session-service, que también reacciona a este mismo evento para crear
  // la sala de video -- ver la nota sobre el segundo queue dedicado en
  // booking-service/src/events/events.publisher.ts.
  @EventPattern("booking.confirmed")
  async handleBookingConfirmed(@Payload() event: BookingConfirmedEvent, @Ctx() context: RmqContext) {
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();
    try {
      await this.transactionsService.chargeForBookingConfirmed({
        bookingId: event.data.bookingId,
        studentId: event.data.studentId,
        tutorProfileId: event.data.tutorId,
        priceSnapshot: event.data.priceSnapshot,
      });
      channel.ack(originalMsg);
    } catch (err) {
      this.logger.error("Error procesando booking.confirmed", err as Error);
      channel.nack(originalMsg, false, true);
    }
  }
}

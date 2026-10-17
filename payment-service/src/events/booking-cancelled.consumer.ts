import { Controller, Inject, Logger, forwardRef } from "@nestjs/common";
import { Ctx, EventPattern, Payload, RmqContext } from "@nestjs/microservices";
import { TransactionsService } from "../transactions/transactions.service";

interface BookingCancelledEvent {
  eventName: string;
  occurredAt: string;
  data: { bookingId: string };
}

@Controller()
export class BookingCancelledConsumer {
  private readonly logger = new Logger(BookingCancelledConsumer.name);

  constructor(
    @Inject(forwardRef(() => TransactionsService))
    private readonly transactionsService: TransactionsService,
  ) {}

  // Comunicación ASÍNCRONA: si la sesión ya se había cobrado y la reserva
  // se cancela (p. ej. el tutor la rechaza), Payment reembolsa
  // automáticamente -- cierra el ciclo reserva → cobro → reembolso sin
  // intervención manual del admin.
  @EventPattern("booking.cancelled")
  async handleBookingCancelled(@Payload() event: BookingCancelledEvent, @Ctx() context: RmqContext) {
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();
    try {
      await this.transactionsService.refundForBookingCancelled(event.data.bookingId);
      channel.ack(originalMsg);
    } catch (err) {
      this.logger.error("Error procesando booking.cancelled", err as Error);
      channel.nack(originalMsg, false, true);
    }
  }
}

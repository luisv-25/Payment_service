import { Controller, Logger, forwardRef, Inject } from "@nestjs/common";
import { Ctx, EventPattern, Payload, RmqContext } from "@nestjs/microservices";
import { RatingsService } from "../ratings/ratings.service";

interface BookingCompletedEvent {
  eventName: string;
  occurredAt: string;
  data: { bookingId: string; studentId: string; tutorId: string; subjectId?: string };
}

@Controller()
export class BookingCompletedConsumer {
  private readonly logger = new Logger(BookingCompletedConsumer.name);

  constructor(
    @Inject(forwardRef(() => RatingsService)) private readonly ratingsService: RatingsService,
  ) {}

  // Comunicación ASÍNCRONA (sección 4.6: "Reacciona a session.completed
  // para habilitar el formulario de valoración"). Escucha booking.completed
  // en vez de session.completed directamente porque Booking Service ya
  // tiene studentId/tutorId/subjectId a la mano al marcar la reserva como
  // completed -- Session Service, en cambio, solo conoce el booking_id, así
  // que pedirle a él enriquecer el evento habría significado una llamada
  // síncrona que el documento prohíbe para este servicio.
  @EventPattern("booking.completed")
  async handleBookingCompleted(
    @Payload() event: BookingCompletedEvent,
    @Ctx() context: RmqContext,
  ) {
    const channel = context.getChannelRef();
    const originalMsg = context.getMessage();
    try {
      await this.ratingsService.markEligible(
        event.data.bookingId,
        event.data.studentId,
        event.data.tutorId,
      );
      channel.ack(originalMsg);
    } catch (err) {
      this.logger.error("Error procesando booking.completed", err as Error);
      channel.nack(originalMsg, false, true);
    }
  }
}

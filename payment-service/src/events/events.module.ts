import { Module, forwardRef } from "@nestjs/common";
import { ClientsModule, Transport } from "@nestjs/microservices";
import { EventsPublisher } from "./events.publisher";
import { BookingConfirmedConsumer } from "./booking-confirmed.consumer";
import { BookingCancelledConsumer } from "./booking-cancelled.consumer";
import { TransactionsModule } from "../transactions/transactions.module";

@Module({
  imports: [
    forwardRef(() => TransactionsModule),
    ClientsModule.register([
      {
        name: "PAYMENT_EVENTS_CLIENT",
        transport: Transport.RMQ,
        options: {
          urls: [process.env.RABBITMQ_URL || "amqp://guest:guest@localhost:5672"],
          // Cola PROPIA de Payment (payment_events_queue), distinta de
          // booking_events_queue que ya consume session-service. Ver la
          // nota en booking-service/src/events/events.publisher.ts: el
          // transporte RMQ de NestJS entrega cada mensaje a un solo
          // consumidor por cola, así que reutilizar la misma cola habría
          // repartido los eventos entre session-service y payment-service
          // en vez de entregárselos a ambos.
          queue: "payment_events_queue",
          queueOptions: { durable: true },
        },
      },
      {
        // Cola de notification-service: "alertas de renovación de paquete
        // de horas" (sección 5.8 del documento). booking-service también
        // publica a esta MISMA cola (booking.confirmed) -- compartir una
        // cola entre dos PRODUCTORES distintos no tiene el problema de
        // compartirla entre dos consumidores (ver la nota en
        // booking-service/src/events/events.publisher.ts).
        name: "NOTIFICATION_EVENTS_CLIENT",
        transport: Transport.RMQ,
        options: {
          urls: [process.env.RABBITMQ_URL || "amqp://guest:guest@localhost:5672"],
          queue: "notification_events_queue",
          queueOptions: { durable: true },
        },
      },
      {
        // Cola DEDICADA y NUEVA para analytics-service -- deliberadamente
        // distinta de "payment_events_queue" (ver nota arriba sobre la colisión
        // de esa cola con el consumidor de booking.confirmed/cancelled).
        name: "ANALYTICS_EVENTS_CLIENT",
        transport: Transport.RMQ,
        options: {
          urls: [process.env.RABBITMQ_URL || "amqp://guest:guest@localhost:5672"],
          queue: "payment_analytics_queue",
          queueOptions: { durable: true },
        },
      },
    ]),
  ],
  providers: [EventsPublisher],
  controllers: [BookingConfirmedConsumer, BookingCancelledConsumer],
  exports: [EventsPublisher],
})
export class EventsModule {}

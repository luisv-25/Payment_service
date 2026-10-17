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
    ]),
  ],
  providers: [EventsPublisher],
  controllers: [BookingConfirmedConsumer, BookingCancelledConsumer],
  exports: [EventsPublisher],
})
export class EventsModule {}

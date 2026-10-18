import { Module, forwardRef } from "@nestjs/common";
import { ClientsModule, Transport } from "@nestjs/microservices";
import { TypeOrmModule } from "@nestjs/typeorm";
import { EventsPublisher } from "./events.publisher";
import { BookingCompletedConsumer } from "./booking-completed.consumer";
import { RatingsModule } from "../ratings/ratings.module";
import { Rating } from "../ratings/entities/rating.entity";

@Module({
  imports: [
    TypeOrmModule.forFeature([Rating]),
    forwardRef(() => RatingsModule),
    ClientsModule.register([
      {
        name: "FEEDBACK_RATING_EVENTS_CLIENT",
        transport: Transport.RMQ,
        options: {
          urls: [process.env.RABBITMQ_URL || "amqp://guest:guest@localhost:5672"],
          // Cola propia — solo Catalog Service la consume, igual patrón
          // que payment_events_queue / booking_events_queue / etc.
          // (cada productor tiene su propia cola; nunca se comparte una
          // cola entre dos consumidores).
          queue: "feedback_rating_events_queue",
          queueOptions: { durable: true },
        },
      },
    ]),
  ],
  providers: [EventsPublisher],
  controllers: [BookingCompletedConsumer],
  exports: [EventsPublisher],
})
export class EventsModule {}

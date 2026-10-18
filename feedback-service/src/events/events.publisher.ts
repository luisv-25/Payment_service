import { Inject, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ClientProxy } from "@nestjs/microservices";

@Injectable()
export class EventsPublisher implements OnModuleInit {
  private readonly logger = new Logger(EventsPublisher.name);

  constructor(
    @Inject("FEEDBACK_RATING_EVENTS_CLIENT") private readonly client: ClientProxy,
  ) {}

  async onModuleInit() {
    await this.client.connect();
  }

  // Sección 5.11 del documento: feedback.rating.updated lo consume Catalog
  // Service (recalcula tutor_profile.avg_rating) y, a futuro, Analytics.
  publishFeedbackRatingUpdated(payload: { tutorId: string; avgRating: number; ratingCount: number }) {
    this.logger.log(`Publicando feedback.rating.updated para tutor ${payload.tutorId}`);
    return this.client.emit("feedback.rating.updated", {
      eventName: "feedback.rating.updated",
      occurredAt: new Date().toISOString(),
      data: payload,
    });
  }
}

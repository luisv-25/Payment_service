import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Rating } from "./entities/rating.entity";
import { SubmitFeedbackDto } from "./dto/submit-feedback.dto";
import { EventsPublisher } from "../events/events.publisher";

@Injectable()
export class RatingsService {
  constructor(
    @InjectRepository(Rating) private readonly ratingsRepo: Repository<Rating>,
    private readonly eventsPublisher: EventsPublisher,
  ) {}

  // Llamado por BookingCompletedConsumer: crea la fila "vacía" que
  // habilita el formulario de valoración. Idempotente -- si el evento
  // llega duplicado (reintentos de RabbitMQ), no hace nada la segunda vez.
  async markEligible(bookingId: string, studentId: string, tutorId: string) {
    const existing = await this.ratingsRepo.findOne({ where: { booking_id: bookingId } });
    if (existing) return existing;
    return this.ratingsRepo.save(
      this.ratingsRepo.create({ booking_id: bookingId, student_id: studentId, tutor_id: tutorId }),
    );
  }

  // Permiso de estudiante: calificar al tutor tras la sesión. El
  // studentId sale del token, igual que en el resto de los servicios.
  async submit(studentId: string, dto: SubmitFeedbackDto) {
    const rating = await this.ratingsRepo.findOne({ where: { booking_id: dto.bookingId } });
    if (!rating) {
      // No existe la fila de elegibilidad: o la reserva no existe, o no
      // está completed todavía, o el evento aún no llegó por RabbitMQ.
      throw new NotFoundException(
        "Esta reserva todavía no está habilitada para calificar (debe estar completada)",
      );
    }
    if (rating.student_id !== studentId) {
      throw new ForbiddenException("Esta reserva no te pertenece");
    }
    if (rating.rated_at) {
      throw new BadRequestException("Ya calificaste esta sesión");
    }

    rating.score = dto.score;
    rating.comment = dto.comment ?? null;
    rating.rated_at = new Date();
    await this.ratingsRepo.save(rating);

    await this.recomputeAndPublishAverage(rating.tutor_id);
    return rating;
  }

  private async recomputeAndPublishAverage(tutorId: string) {
    const { avg, count } = await this.ratingsRepo
      .createQueryBuilder("r")
      .select("AVG(r.score)", "avg")
      .addSelect("COUNT(r.id)", "count")
      .where("r.tutor_id = :tutorId", { tutorId })
      .andWhere("r.rated_at IS NOT NULL")
      .getRawOne();

    this.eventsPublisher.publishFeedbackRatingUpdated({
      tutorId,
      avgRating: Number(Number(avg).toFixed(2)),
      ratingCount: Number(count),
    });
  }

  // Solo ratings ya calificados -- las filas "pendientes" (rated_at null)
  // son plumbing interno, no se publican en GET /feedback/tutor/{id}.
  listForTutor(tutorId: string) {
    return this.ratingsRepo
      .createQueryBuilder("r")
      .where("r.tutor_id = :tutorId", { tutorId })
      .andWhere("r.rated_at IS NOT NULL")
      .orderBy("r.rated_at", "DESC")
      .getMany();
  }
}

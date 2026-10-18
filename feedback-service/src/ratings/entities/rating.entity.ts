import { Check, Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

// Coincide con la sección 5.6 del documento: id, booking_id, score,
// comment, created_at. Se agregan tutor_id/student_id (referencias
// lógicas, no están en el esquema del documento) porque Feedback Service
// "no expone llamadas salientes síncronas" (sección 4.6) — sin ellas,
// GET /feedback/tutor/{id} no podría resolver qué ratings son de qué
// tutor sin llamar a Booking en cada request. Se completan solas al
// consumir booking.completed (ver BookingCompletedConsumer).
//
// La fila se crea "vacía" (score/rated_at en null) en cuanto la reserva
// se completa — eso es lo que habilita el formulario de valoración
// (sección 4.6: "Reacciona a session.completed para habilitar el
// formulario de valoración") y, de paso, es lo que hace cumplir
// "UNIQUE booking_id en ratings (una sola calificación por sesión)":
// POST /feedback solo puede RELLENAR esa fila, nunca crear una segunda.
@Entity("ratings")
@Check(`"score" IS NULL OR ("score" >= 1 AND "score" <= 5)`)
export class Rating {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Index({ unique: true })
  @Column()
  booking_id: string;

  @Index()
  @Column()
  tutor_id: string;

  @Column()
  student_id: string;

  @Column({ type: "int", nullable: true })
  score: number | null;

  @Column({ type: "text", nullable: true })
  comment: string | null;

  // Momento en que la reserva quedó completada (elegible para calificar),
  // no el momento en que se creó el registro en sí — ambos coinciden.
  @CreateDateColumn()
  created_at: Date;

  // Null mientras está pendiente de calificar; se llena en POST /feedback.
  @Column({ type: "timestamptz", nullable: true })
  rated_at: Date | null;
}

import { Check, Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

export enum TransactionStatus {
  PENDING = "pending",
  SUCCEEDED = "succeeded",
  FAILED = "failed",
}

// Sección 5.5 del documento de arquitectura.
@Entity("transactions")
@Check(`"status" IN ('pending','succeeded','failed')`)
export class Transaction {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  // FK real dentro de payment_db (packages.id) cuando el cobro se pagó con
  // un paquete de horas, o es la compra misma del paquete; null cuando es
  // un cobro individual por sesión.
  @Index()
  @Column({ type: "uuid", nullable: true })
  package_id: string | null;

  // Referencia LÓGICA a booking_db.bookings.id (sección 5.10): el cobro
  // de una sesión siempre queda ligado a su reserva, salvo la compra de un
  // paquete (que no corresponde a ninguna reserva puntual).
  @Index()
  @Column({ type: "uuid", nullable: true })
  booking_id: string | null;

  // Referencias lógicas a user_db.users.id. Se desnormalizan aquí (en vez
  // de resolverlas contra Booking/Catalog en cada consulta) por la misma
  // razón que booking.price_snapshot en booking-service: sin esto, calcular
  // la liquidación periódica de un tutor exigiría un round-trip síncrono
  // por cada transacción.
  @Index()
  @Column({ type: "uuid", nullable: true })
  student_id: string | null;

  @Index()
  @Column({ type: "uuid", nullable: true })
  tutor_id: string | null;

  @Column({ type: "numeric", precision: 10, scale: 2 })
  amount: number;

  @Column({ type: "enum", enum: TransactionStatus, default: TransactionStatus.PENDING })
  status: TransactionStatus;

  // Retención de comisión de la plataforma (sección 5.5). Se congela la
  // tasa vigente al momento del cobro junto con el monto ya calculado,
  // para que la liquidación a tutores no dependa de la tasa ACTUAL si esta
  // cambia más adelante.
  @Column({ type: "numeric", precision: 5, scale: 4, default: 0 })
  commission_rate: number;

  @Column({ type: "numeric", precision: 10, scale: 2, default: 0 })
  commission_amount: number;

  @Column({ type: "numeric", precision: 10, scale: 2, default: 0 })
  tutor_net_amount: number;

  // UNIQUE gateway_reference (sección 5.5): evita procesar el mismo cobro
  // dos veces si RabbitMQ reentrega booking.confirmed (idempotencia).
  @Column({ unique: true })
  gateway_reference: string;

  @CreateDateColumn()
  created_at: Date;
}

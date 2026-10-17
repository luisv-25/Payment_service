import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

// Sección 5.5 del documento de arquitectura. 3FN: se aísla de transactions
// porque un reembolso puede ser PARCIAL, dando lugar a más de un registro
// de refund por cada transacción -- por eso transactions.status nunca pasa
// a "reembolsado": el estado del reembolso vive solo aquí.
@Entity("refunds")
export class Refund {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  // FK real dentro de payment_db (transactions.id).
  @Index()
  @Column({ type: "uuid" })
  transaction_id: string;

  @Column({ type: "numeric", precision: 10, scale: 2 })
  amount: number;

  @Column({ type: "text", nullable: true })
  reason: string | null;

  @CreateDateColumn({ name: "processed_at" })
  processed_at: Date;
}

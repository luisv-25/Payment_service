import { Check, Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

// Sección 5.5 del documento de arquitectura: paquete de horas prepagado
// que un estudiante compra por adelantado. Cada sesión confirmada
// descuenta de hours_remaining en vez de generar un cobro individual,
// mientras queden horas disponibles.
@Entity("packages")
@Check(`"hours_remaining" >= 0`)
export class Package {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  // Referencia LÓGICA a user_db.users.id — sin FK física entre bases
  // distintas, mismo criterio que en el resto de los microservicios
  // (sección 5.10 del documento).
  @Index()
  @Column({ type: "uuid" })
  student_id: string;

  @Column({ type: "int" })
  hours_purchased: number;

  @Column({ type: "int" })
  hours_remaining: number;

  @CreateDateColumn({ name: "purchased_at" })
  purchased_at: Date;
}

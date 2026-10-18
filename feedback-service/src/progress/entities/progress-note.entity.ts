import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

// Coincide exactamente con la sección 5.6 del documento: id, student_id
// (referencia lógica), subject_id (referencia lógica), note, created_at.
// Tabla independiente de ratings (no comparten FK directa, sección 5.6).
@Entity("progress_notes")
@Index(["student_id", "subject_id"])
export class ProgressNote {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column()
  student_id: string;

  @Column()
  subject_id: string;

  @Column({ type: "text" })
  note: string;

  @CreateDateColumn()
  created_at: Date;
}

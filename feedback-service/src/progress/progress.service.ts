import { ForbiddenException, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { ProgressNote } from "./entities/progress-note.entity";
import { CreateProgressNoteDto } from "./dto/create-progress-note.dto";

interface Requester {
  id: string;
  role: string;
}

@Injectable()
export class ProgressService {
  constructor(
    @InjectRepository(ProgressNote) private readonly progressRepo: Repository<ProgressNote>,
  ) {}

  // "progreso académico declarado DEL estudiante" (sección 4.6) -- se lee
  // como autorreporte del propio estudiante, por eso studentId sale del
  // token y no del body.
  create(studentId: string, dto: CreateProgressNoteDto) {
    return this.progressRepo.save(
      this.progressRepo.create({ student_id: studentId, subject_id: dto.subjectId, note: dto.note }),
    );
  }

  // GET /progress/student/{id} del documento. El propio estudiante ve las
  // suyas; tutor/admin pueden consultar las de cualquiera.
  async listForStudent(studentId: string, requester: Requester) {
    if (requester.role === "student" && requester.id !== studentId) {
      throw new ForbiddenException("No puedes ver el progreso de otro estudiante");
    }
    return this.progressRepo.find({
      where: { student_id: studentId },
      order: { created_at: "DESC" },
    });
  }
}

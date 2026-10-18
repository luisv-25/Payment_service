import { Body, Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { ProgressService } from "./progress.service";
import { CreateProgressNoteDto } from "./dto/create-progress-note.dto";
import { JwtRolesGuard } from "../common/jwt-roles.guard";
import { Roles } from "../common/roles.decorator";

@Controller("progress")
export class ProgressController {
  constructor(private readonly progressService: ProgressService) {}

  @Post()
  @UseGuards(JwtRolesGuard)
  @Roles("student")
  create(@Body() dto: CreateProgressNoteDto, @Req() req: any) {
    return this.progressService.create(req.user.id, dto);
  }

  // GET /progress/student/{id} del documento.
  @Get("student/:studentId")
  @UseGuards(JwtRolesGuard)
  listForStudent(@Param("studentId") studentId: string, @Req() req: any) {
    return this.progressService.listForStudent(studentId, req.user);
  }
}

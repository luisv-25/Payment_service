import { Body, Controller, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { RatingsService } from "./ratings.service";
import { SubmitFeedbackDto } from "./dto/submit-feedback.dto";
import { JwtRolesGuard } from "../common/jwt-roles.guard";
import { Roles } from "../common/roles.decorator";

@Controller()
export class RatingsController {
  constructor(private readonly ratingsService: RatingsService) {}

  // POST /feedback del documento (sección 4.6).
  @Post("feedback")
  @UseGuards(JwtRolesGuard)
  @Roles("student")
  submit(@Body() dto: SubmitFeedbackDto, @Req() req: any) {
    return this.ratingsService.submit(req.user.id, dto);
  }

  // GET /feedback/tutor/{id} del documento (sección 4.6) -- público, igual
  // que GET /tutors en Catalog.
  @Get("feedback/tutor/:tutorId")
  listForTutor(@Param("tutorId") tutorId: string) {
    return this.ratingsService.listForTutor(tutorId);
  }
}

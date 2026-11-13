import { Body, Controller, ForbiddenException, Get, HttpCode, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { IsOptional, IsString, IsUUID, MaxLength } from "class-validator";
import { PayoutsService } from "./payouts.service";
import { JwtRolesGuard } from "../common/jwt-roles.guard";
import { Roles } from "../common/roles.decorator";

class GenerateDto {
  @IsOptional()
  @IsUUID()
  tutorId?: string;
}

class MarkPaidDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reference?: string;
}

@Controller()
export class PayoutsController {
  constructor(private readonly payouts: PayoutsService) {}

  // Saldo pendiente de liquidar de todos los tutores.
  @Get("payouts/open")
  @UseGuards(JwtRolesGuard)
  @Roles("admin")
  open() {
    return this.payouts.openBalances();
  }

  // Saldo pendiente de un tutor: el propio tutor o un admin.
  @Get("payouts/open/tutor/:tutorId")
  @UseGuards(JwtRolesGuard)
  @Roles("admin", "tutor")
  openForTutor(@Param("tutorId") tutorId: string, @Req() req: any) {
    if (req.user.role === "tutor" && req.user.id !== tutorId) throw new ForbiddenException("Solo puedes ver tu propia liquidación");
    return this.payouts.openBalanceForTutor(tutorId);
  }

  // Hace el corte (todos los tutores, o uno si se manda tutorId).
  @Post("payouts/generate")
  @HttpCode(200)
  @UseGuards(JwtRolesGuard)
  @Roles("admin")
  generate(@Body() dto: GenerateDto) {
    return this.payouts.generate(dto.tutorId);
  }

  // Historial: el admin ve todas; el tutor, solo las suyas.
  @Get("payouts")
  @UseGuards(JwtRolesGuard)
  @Roles("admin", "tutor")
  list(@Query("tutorId") tutorId: string | undefined, @Query("status") status: string | undefined, @Req() req: any) {
    return this.payouts.list({ tutorId: req.user.role === "tutor" ? req.user.id : tutorId, status });
  }

  @Post("payouts/:id/paid")
  @HttpCode(200)
  @UseGuards(JwtRolesGuard)
  @Roles("admin")
  markPaid(@Param("id") id: string, @Body() dto: MarkPaidDto) {
    return this.payouts.markPaid(id, dto.reference);
  }
}

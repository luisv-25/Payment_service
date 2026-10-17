import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { TransactionsService } from "./transactions.service";
import { RefundTransactionDto } from "./dto/refund-transaction.dto";
import { JwtRolesGuard } from "../common/jwt-roles.guard";
import { Roles } from "../common/roles.decorator";

@Controller()
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Get("transactions")
  @UseGuards(JwtRolesGuard)
  findAll(
    @Query("studentId") studentId: string | undefined,
    @Query("tutorId") tutorId: string | undefined,
    @Query("bookingId") bookingId: string | undefined,
    @Req() req: any,
  ) {
    return this.transactionsService.findAll({ studentId, tutorId, bookingId }, req.user);
  }

  @Get("transactions/:id")
  @UseGuards(JwtRolesGuard)
  findOne(@Param("id") id: string) {
    return this.transactionsService.findOne(id);
  }

  @Get("transactions/:id/refunds")
  @UseGuards(JwtRolesGuard)
  listRefunds(@Param("id") id: string) {
    return this.transactionsService.listRefunds(id);
  }

  // Reembolso manual (admin). El reembolso automático por cancelación de
  // reserva lo dispara BookingCancelledConsumer, no este endpoint.
  @Post("transactions/:id/refund")
  @UseGuards(JwtRolesGuard)
  @Roles("admin")
  refund(@Param("id") id: string, @Body() dto: RefundTransactionDto, @Req() req: any) {
    return this.transactionsService.manualRefund(id, dto, req.user);
  }

  // Liquidación periódica de un tutor concreto: el propio tutor puede ver
  // la suya, un admin puede ver cualquiera (sección 5.5 del documento).
  @Get("settlements/tutor/:tutorId")
  @UseGuards(JwtRolesGuard)
  @Roles("admin", "tutor")
  settlementForTutor(@Param("tutorId") tutorId: string, @Req() req: any) {
    if (req.user.role === "tutor" && req.user.id !== tutorId) {
      throw new ForbiddenException("Solo puedes ver tu propia liquidación");
    }
    return this.transactionsService.settlementForTutor(tutorId);
  }

  // Panel admin: liquidación de todos los tutores con cobros exitosos.
  @Get("settlements")
  @UseGuards(JwtRolesGuard)
  @Roles("admin")
  settlementSummary() {
    return this.transactionsService.settlementSummary();
  }
}

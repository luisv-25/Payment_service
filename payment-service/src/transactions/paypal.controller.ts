import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from "@nestjs/common";
import { IsString, MinLength } from "class-validator";
import { PaypalPaymentsService } from "./paypal-payments.service";
import { PaypalClient } from "./paypal.client";
import { JwtRolesGuard } from "../common/jwt-roles.guard";
import { Roles } from "../common/roles.decorator";

class CaptureDto {
  @IsString()
  @MinLength(3)
  orderId: string;
}

@Controller()
export class PaypalController {
  constructor(
    private readonly paypalPayments: PaypalPaymentsService,
    private readonly paypalClient: PaypalClient,
  ) {}

  // Público: el frontend lo usa para saber si el pago real está activo y con
  // qué client-id cargar los botones de PayPal (el client-id es público; el
  // secret nunca sale del servidor).
  @Get("paypal/status")
  status() {
    return {
      enabled: this.paypalPayments.enabled,
      clientId: this.paypalPayments.enabled ? this.paypalClient.publicClientId : null,
      currency: this.paypalClient.currency,
    };
  }

  @Post("transactions/:id/paypal/order")
  @HttpCode(200)
  @UseGuards(JwtRolesGuard)
  @Roles("student")
  order(@Param("id") id: string, @Req() req: any) {
    return this.paypalPayments.createOrder(id, req.user);
  }

  @Post("transactions/:id/paypal/capture")
  @HttpCode(200)
  @UseGuards(JwtRolesGuard)
  @Roles("student")
  capture(@Param("id") id: string, @Body() dto: CaptureDto, @Req() req: any) {
    return this.paypalPayments.captureOrder(id, dto.orderId, req.user);
  }
}

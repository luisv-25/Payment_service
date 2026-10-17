import { Injectable, Logger } from "@nestjs/common";

export interface GatewayChargeResult {
  succeeded: boolean;
  isMock: boolean;
}

// Esta entrega no integra una pasarela de pago real (Stripe/PayU/etc. no
// hacen parte del alcance del curso): el cobro se SIMULA siempre como
// exitoso, en vez de inventar un proveedor o datos de tarjeta falsos.
// Queda aislado en esta sola clase -- mismo criterio que DailyClient en
// session-service -- para que conectar una pasarela real en el futuro sea
// un cambio de una sola pieza, sin tocar TransactionsService.
@Injectable()
export class GatewayClient {
  private readonly logger = new Logger(GatewayClient.name);

  charge(reference: string): GatewayChargeResult {
    this.logger.log(`Cobro SIMULADO procesado — referencia ${reference}`);
    return { succeeded: true, isMock: true };
  }
}

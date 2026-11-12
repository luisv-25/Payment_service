import { HttpService } from "@nestjs/axios";
import { Injectable, Logger } from "@nestjs/common";
import { firstValueFrom } from "rxjs";

export interface PaypalOrder {
  id: string;
  status: string; // CREATED | APPROVED | COMPLETED | ...
  purchase_units?: Array<{
    custom_id?: string;
    amount?: { currency_code: string; value: string };
    payments?: { captures?: Array<{ id: string; status: string }> };
  }>;
}

// Integración con PayPal Checkout (Orders API v2), en SANDBOX por defecto.
// Mismo criterio "mock-first" que los demás clientes: sin PAYPAL_CLIENT_ID /
// PAYPAL_CLIENT_SECRET, isConfigured es false y el servicio cae al cobro
// SIMULADO. La tarjeta/cuenta del estudiante nunca pasa por aquí: paga en los
// botones de PayPal y este cliente solo crea la orden, la consulta y la captura.
// PayPal no maneja COP, así que el monto se convierte a USD con una tasa fija
// configurable (PAYPAL_COP_PER_USD, por defecto 4000) -- la transacción en
// nuestra base de datos sigue en COP.
@Injectable()
export class PaypalClient {
  private readonly logger = new Logger(PaypalClient.name);

  private readonly clientId = process.env.PAYPAL_CLIENT_ID || "";
  private readonly clientSecret = process.env.PAYPAL_CLIENT_SECRET || "";
  private readonly apiBase =
    process.env.PAYPAL_API_URL ||
    (process.env.PAYPAL_ENV === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com");
  private readonly copPerUsd = Number(process.env.PAYPAL_COP_PER_USD) || 4000;
  readonly currency = "USD";

  private token: { value: string; expiresAt: number } | null = null;

  constructor(private readonly http: HttpService) {
    if (!this.isConfigured) {
      this.logger.warn(
        "PayPal no configurado (faltan PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET): los cobros se SIMULAN (modo simulado)",
      );
    }
  }

  get isConfigured(): boolean {
    return Boolean(this.clientId && this.clientSecret);
  }

  get publicClientId(): string {
    return this.clientId;
  }

  // COP -> USD con 2 decimales (formato que exige PayPal: string "12.34").
  toUsd(copAmount: number | string): string {
    return (Number(copAmount) / this.copPerUsd).toFixed(2);
  }

  private async getToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 30_000) return this.token.value;
    const res = await firstValueFrom(
      this.http.post(`${this.apiBase}/v1/oauth2/token`, "grant_type=client_credentials", {
        auth: { username: this.clientId, password: this.clientSecret },
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeout: 10000,
      }),
    );
    this.token = { value: res.data.access_token, expiresAt: Date.now() + Number(res.data.expires_in || 300) * 1000 };
    return this.token.value;
  }

  private async headers(extra: Record<string, string> = {}) {
    return { Authorization: `Bearer ${await this.getToken()}`, "Content-Type": "application/json", ...extra };
  }

  async createOrder(params: { customId: string; copAmount: number | string; description: string }): Promise<PaypalOrder> {
    const res = await firstValueFrom(
      this.http.post(
        `${this.apiBase}/v2/checkout/orders`,
        {
          intent: "CAPTURE",
          purchase_units: [
            {
              custom_id: params.customId,
              description: params.description.slice(0, 120),
              amount: { currency_code: this.currency, value: this.toUsd(params.copAmount) },
            },
          ],
        },
        { headers: await this.headers(), timeout: 10000 },
      ),
    );
    return res.data;
  }

  async getOrder(orderId: string): Promise<PaypalOrder> {
    const res = await firstValueFrom(
      this.http.get(`${this.apiBase}/v2/checkout/orders/${encodeURIComponent(orderId)}`, {
        headers: await this.headers(),
        timeout: 10000,
      }),
    );
    return res.data;
  }

  // PayPal-Request-Id hace la captura idempotente si el navegador reintenta.
  async captureOrder(orderId: string): Promise<PaypalOrder> {
    const res = await firstValueFrom(
      this.http.post(
        `${this.apiBase}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
        {},
        { headers: await this.headers({ "PayPal-Request-Id": `capture-${orderId}` }), timeout: 15000 },
      ),
    );
    return res.data;
  }
}

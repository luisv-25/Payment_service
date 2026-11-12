import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Transaction, TransactionStatus } from "./entities/transaction.entity";
import { Package } from "../packages/entities/package.entity";
import { EventsPublisher } from "../events/events.publisher";
import { PaypalClient } from "./paypal.client";

// Sufijo que se agrega a gateway_reference cuando una reserva se cancela
// antes de pagarse: la transacción queda FAILED y ya no se puede pagar
// (ver TransactionsService.refundForBookingCancelled).
export const VOID_SUFFIX = ".cancelled";

interface Requester {
  id: string;
  role: string;
}

// Pago en línea con PayPal: (1) createOrder crea la orden en PayPal con el
// monto calculado AQUÍ (nunca el que mande el navegador) y la ata a nuestra
// transacción con custom_id; (2) el estudiante aprueba en los botones de
// PayPal; (3) capture verifica que la orden sea de esa transacción y con el
// monto correcto, la captura y recién entonces marca el pago como exitoso.
@Injectable()
export class PaypalPaymentsService {
  private readonly logger = new Logger(PaypalPaymentsService.name);

  constructor(
    @InjectRepository(Transaction) private readonly txRepo: Repository<Transaction>,
    @InjectRepository(Package) private readonly packagesRepo: Repository<Package>,
    private readonly paypalClient: PaypalClient,
    private readonly eventsPublisher: EventsPublisher,
  ) {}

  get enabled() {
    return this.paypalClient.isConfigured;
  }

  private async loadPayableTx(transactionId: string, requester: Requester) {
    if (!this.paypalClient.isConfigured) {
      throw new ServiceUnavailableException("Los pagos en línea no están configurados (modo simulado)");
    }
    const tx = await this.txRepo.findOne({ where: { id: transactionId } });
    if (!tx) throw new NotFoundException(`Transacción ${transactionId} no encontrada`);
    if (requester.role !== "student" || tx.student_id !== requester.id) {
      throw new ForbiddenException("Solo el estudiante que debe este pago puede pagarlo");
    }
    if (tx.gateway_reference.endsWith(VOID_SUFFIX)) {
      throw new ConflictException("Esta transacción fue anulada porque la reserva se canceló");
    }
    if (Number(tx.amount) <= 0) throw new ConflictException("Esta transacción no tiene nada que pagar");
    return tx;
  }

  async createOrder(transactionId: string, requester: Requester) {
    const tx = await this.loadPayableTx(transactionId, requester);
    if (tx.status === TransactionStatus.SUCCEEDED) throw new ConflictException("Esta transacción ya fue pagada");
    try {
      const order = await this.paypalClient.createOrder({
        customId: tx.id,
        copAmount: tx.amount,
        description: tx.booking_id ? "Tutoría EduConecta" : "Paquete de horas EduConecta",
      });
      return { orderId: order.id, usdAmount: this.paypalClient.toUsd(tx.amount) };
    } catch (err) {
      this.logger.error(`No se pudo crear la orden en PayPal: ${(err as Error).message}`);
      throw new BadGatewayException("No se pudo iniciar el pago con PayPal");
    }
  }

  async captureOrder(transactionId: string, orderId: string, requester: Requester) {
    const tx = await this.loadPayableTx(transactionId, requester);
    if (tx.status === TransactionStatus.SUCCEEDED) return { status: "COMPLETED", transaction: tx };

    let order;
    try {
      order = await this.paypalClient.getOrder(orderId);
    } catch (err) {
      this.logger.warn(`No se pudo consultar la orden ${orderId}: ${(err as Error).message}`);
      throw new BadGatewayException("No se pudo verificar el pago con PayPal");
    }
    const unit = order.purchase_units?.[0];
    if (unit?.custom_id !== tx.id) throw new BadRequestException("Esa orden de PayPal no corresponde a esta transacción");
    if (unit?.amount?.value !== this.paypalClient.toUsd(tx.amount) || unit?.amount?.currency_code !== this.paypalClient.currency) {
      throw new BadRequestException("El monto de la orden de PayPal no coincide");
    }

    let captured = order;
    if (order.status !== "COMPLETED") {
      try {
        captured = await this.paypalClient.captureOrder(orderId);
      } catch (err) {
        // Pago rechazado/no aprobado: la transacción sigue pendiente y puede reintentarse.
        this.logger.warn(`Captura fallida de ${orderId}: ${(err as Error).message}`);
        return { status: "FAILED", transaction: tx };
      }
    }
    const capture = captured.purchase_units?.[0]?.payments?.captures?.[0];
    if (captured.status !== "COMPLETED" || (capture && capture.status !== "COMPLETED")) {
      return { status: captured.status, transaction: tx }; // p. ej. PENDING de PayPal
    }

    tx.status = TransactionStatus.SUCCEEDED;
    await this.txRepo.save(tx);
    if (tx.package_id && !tx.booking_id) {
      // Compra de paquete: las horas se acreditan SOLO ahora que el pago fue
      // aprobado (el paquete se creó con hours_remaining = 0).
      const pkg = await this.packagesRepo.findOne({ where: { id: tx.package_id } });
      if (pkg) {
        pkg.hours_remaining = pkg.hours_purchased;
        await this.packagesRepo.save(pkg);
      }
    }
    this.eventsPublisher.publishPaymentSucceeded(tx);
    return { status: "COMPLETED", transaction: tx };
  }
}

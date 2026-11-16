import { TransactionsService } from "../../src/transactions/transactions.service";
import { TransactionStatus } from "../../src/transactions/entities/transaction.entity";

// Construye el servicio con TODAS las dependencias simuladas (sin BD, sin PayPal, sin RabbitMQ).
function crearServicio(opts: { paquete?: any; existente?: any; paypal?: boolean } = {}) {
  const qb: any = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(opts.paquete ?? null),
  };
  const txRepo: any = {
    findOne: jest.fn().mockResolvedValue(opts.existente ?? null),
    create: jest.fn((x) => x),
    save: jest.fn(async (x) => ({ id: "tx-1", ...x })),
  };
  const packagesRepo: any = { createQueryBuilder: jest.fn(() => qb), save: jest.fn(async (x) => x) };
  const refundsRepo: any = {
    count: jest.fn().mockResolvedValue(0),
    create: jest.fn((x) => x),
    save: jest.fn(async (x) => ({ id: "rf-1", ...x })),
  };
  const gateway: any = { charge: jest.fn().mockReturnValue({ succeeded: true }) };
  const paypal: any = { isConfigured: !!opts.paypal };
  const catalog: any = { getTutorProfile: jest.fn().mockResolvedValue({ user: { id: "tutor-user-1" } }) };
  const events: any = {
    publishPaymentSucceeded: jest.fn(),
    publishPaymentFailed: jest.fn(),
    publishPaymentRefunded: jest.fn(),
  };
  const service = new TransactionsService(txRepo, packagesRepo, refundsRepo, gateway, paypal, catalog, events);
  return { service, txRepo, packagesRepo, refundsRepo, gateway, catalog, events };
}

const reserva = { bookingId: "b-1", studentId: "est-1", tutorProfileId: "perfil-1", priceSnapshot: 100000 };

describe("TransactionsService: cobro por reserva confirmada y reembolsos (mocks)", () => {
  it("Unitaria 1: cobra la reserva con 15% de comisión, descuenta del paquete si hay saldo y es idempotente", async () => {
    // Sin paquete: cobro individual con comisión de plataforma (15%) y tutor_id resuelto vía Catalog
    const a = crearServicio();
    const tx = await a.service.chargeForBookingConfirmed(reserva);
    expect(tx).toMatchObject({
      amount: 100000,
      status: TransactionStatus.SUCCEEDED,
      commission_rate: 0.15,
      commission_amount: 15000,
      tutor_net_amount: 85000,
      tutor_id: "tutor-user-1",
      gateway_reference: "booking-b-1",
      package_id: null,
    });
    expect(a.events.publishPaymentSucceeded).toHaveBeenCalledTimes(1);

    // Con paquete activo: monto 0, sin comisión y se descuenta 1 hora del saldo
    const paquete = { id: "pkg-1", hours_remaining: 3 };
    const b = crearServicio({ paquete });
    const txPaquete = await b.service.chargeForBookingConfirmed(reserva);
    expect(txPaquete).toMatchObject({ amount: 0, commission_amount: 0, package_id: "pkg-1" });
    expect(paquete.hours_remaining).toBe(2);
    expect(b.packagesRepo.save).toHaveBeenCalledWith(paquete);

    // Idempotencia: si el evento se reentrega no hay segundo cobro ni nuevo evento
    const existente = { id: "tx-previa", booking_id: "b-1" };
    const c = crearServicio({ existente });
    expect(await c.service.chargeForBookingConfirmed(reserva)).toBe(existente);
    expect(c.txRepo.save).not.toHaveBeenCalled();
    expect(c.gateway.charge).not.toHaveBeenCalled();
    expect(c.events.publishPaymentSucceeded).not.toHaveBeenCalled();
  });

  it("Unitaria 2: el reembolso manual solo lo hace un admin, respeta el saldo reembolsable y el automático devuelve la hora al paquete", async () => {
    const admin = { id: "adm-1", role: "admin" };
    const exitosa = { id: "tx-1", status: TransactionStatus.SUCCEEDED, amount: "100000.00", package_id: null };
    const preparar = (reembolsado: string, tx: any = exitosa) => {
      const s = crearServicio();
      s.txRepo.findOne.mockResolvedValue(tx);
      s.refundsRepo.createQueryBuilder = jest.fn(() => ({
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ total: reembolsado }),
      }));
      return s;
    };

    // Rol no admin -> prohibido
    await expect(preparar("0").service.manualRefund("tx-1", {}, { id: "u", role: "student" })).rejects.toThrow(
      "Solo un administrador",
    );
    // Transacción no exitosa -> conflicto
    await expect(
      preparar("0", { ...exitosa, status: TransactionStatus.PENDING }).service.manualRefund("tx-1", {}, admin),
    ).rejects.toThrow("transacción exitosa");
    // Monto mayor al saldo reembolsable (100000 - 70000 = 30000) -> conflicto
    await expect(preparar("70000").service.manualRefund("tx-1", { amount: 40000 }, admin)).rejects.toThrow(
      "Monto de reembolso inválido; disponible: 30000.00",
    );
    // Ya reembolsada por completo -> conflicto
    await expect(preparar("100000").service.manualRefund("tx-1", {}, admin)).rejects.toThrow("por completo");
    // Reembolso parcial válido y reembolso del saldo restante cuando se omite el monto
    const ok = preparar("70000");
    const parcial = await ok.service.manualRefund("tx-1", { amount: 10000 }, admin);
    expect(parcial.amount).toBe(10000);
    const resto = await preparar("70000").service.manualRefund("tx-1", {}, admin);
    expect(resto.amount).toBe(30000);
    expect(ok.events.publishPaymentRefunded).toHaveBeenCalledTimes(1);

    // Reembolso automático por cancelación: reembolsa el total y devuelve la hora al paquete
    const s = crearServicio();
    const pkg = { id: "pkg-1", hours_remaining: 1 };
    s.txRepo.findOne.mockResolvedValue({ id: "tx-2", status: TransactionStatus.SUCCEEDED, amount: 0, package_id: "pkg-1" });
    s.packagesRepo.findOne = jest.fn().mockResolvedValue(pkg);
    const refund = await s.service.refundForBookingCancelled("b-2");
    expect(refund).toMatchObject({ transaction_id: "tx-2", reason: "Reserva cancelada" });
    expect(pkg.hours_remaining).toBe(2);

    // Idempotente: con un reembolso previo no vuelve a reembolsar
    const dup = crearServicio();
    dup.txRepo.findOne.mockResolvedValue({ id: "tx-2", status: TransactionStatus.SUCCEEDED, amount: 5, package_id: null });
    dup.refundsRepo.count.mockResolvedValue(1);
    expect(await dup.service.refundForBookingCancelled("b-2")).toBeNull();
    expect(dup.refundsRepo.save).not.toHaveBeenCalled();
  });
});

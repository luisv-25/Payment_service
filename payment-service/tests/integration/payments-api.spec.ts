import { INestApplication } from "@nestjs/common";
import request from "supertest";

// PayPal NO configurado: los cobros se simulan (sin red). Debe fijarse antes de cargar los módulos.
delete process.env.PAYPAL_CLIENT_ID;
delete process.env.PAYPAL_CLIENT_SECRET;

import { AppModule } from "../../src/app.module";
import { EventsPublisher } from "../../src/events/events.publisher";
import { CatalogServiceClient } from "../../src/transactions/catalog-service.client";
import { TransactionsService } from "../../src/transactions/transactions.service";
import { createTestApp, fakeEventsPublisher, tokenFor } from "../helpers/test-app";

const ESTUDIANTE = "11111111-1111-4111-8111-111111111111";
const OTRO_ESTUDIANTE = "22222222-2222-4222-8222-222222222222";
const TUTOR = "33333333-3333-4333-8333-333333333333";
const ADMIN = "44444444-4444-4444-8444-444444444444";
const auth = (id: string, rol: "student" | "tutor" | "admin") => ({ Authorization: `Bearer ${tokenFor(id, rol)}` });

// Solo se reemplazan RabbitMQ (publicador falso) y Catalog Service (cliente HTTP falso).
describe("Integración: paquetes de horas, cobro con comisión y reembolsos", () => {
  let app: INestApplication;
  const events = fakeEventsPublisher();
  const catalog = { getTutorProfile: jest.fn().mockResolvedValue({ user: { id: TUTOR } }) };

  beforeAll(async () => {
    app = await createTestApp(
      [AppModule],
      [
        { provide: EventsPublisher, useValue: events },
        { provide: CatalogServiceClient, useValue: catalog },
      ],
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it("compra un paquete (simulado), cobra reservas con comisión, reembolsa y liquida al tutor (todo en PostgreSQL)", async () => {
    const http = request(app.getHttpServer());
    const servicio = app.get(TransactionsService);

    // Validación y autorización de la compra
    await http.post("/api/v1/packages").send({ hoursPurchased: 2, amount: 80000 }).expect(401);
    await http.post("/api/v1/packages").set(auth(TUTOR, "tutor")).send({ hoursPurchased: 2, amount: 80000 }).expect(403);
    await http.post("/api/v1/packages").set(auth(ESTUDIANTE, "student")).send({ hoursPurchased: 0, amount: 80000 }).expect(400);

    // COMPRAR: sin PayPal el paquete queda con todas sus horas y la transacción exitosa, sin comisión
    const compra = await http.post("/api/v1/packages").set(auth(ESTUDIANTE, "student")).send({ hoursPurchased: 2, amount: 80000 }).expect(201);
    expect(compra.body).toMatchObject({ student_id: ESTUDIANTE, hours_purchased: 2, hours_remaining: 2 });
    expect(compra.body.requiresPayment).toBeUndefined();
    const pkgId = compra.body.id;

    const txCompra = await http.get("/api/v1/transactions").set(auth(ESTUDIANTE, "student")).expect(200);
    expect(txCompra.body).toHaveLength(1);
    expect(txCompra.body[0]).toMatchObject({
      package_id: pkgId,
      status: "succeeded",
      amount: "80000.00",
      commission_amount: "0.00",
      gateway_reference: `package-${pkgId}`,
    });

    // Propiedad del paquete: otro estudiante 403, el dueño 200
    await http.get(`/api/v1/packages/${pkgId}`).set(auth(OTRO_ESTUDIANTE, "student")).expect(403);
    await http.get(`/api/v1/packages/${pkgId}`).set(auth(ESTUDIANTE, "student")).expect(200);

    // RESERVA 1 con paquete activo: cobro de 0 y se descuenta 1 hora
    const reservaPaquete = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const t1 = await servicio.chargeForBookingConfirmed({ bookingId: reservaPaquete, studentId: ESTUDIANTE, tutorProfileId: "perfil-1", priceSnapshot: 40000 });
    expect(Number(t1!.amount)).toBe(0);
    let pkg = await http.get(`/api/v1/packages/${pkgId}`).set(auth(ESTUDIANTE, "student")).expect(200);
    expect(pkg.body.hours_remaining).toBe(1);

    // Idempotencia: reentregar el evento no duplica el cobro ni descuenta otra hora
    await servicio.chargeForBookingConfirmed({ bookingId: reservaPaquete, studentId: ESTUDIANTE, tutorProfileId: "perfil-1", priceSnapshot: 40000 });
    const porReserva = await http.get(`/api/v1/transactions?bookingId=${reservaPaquete}`).set(auth(ADMIN, "admin")).expect(200);
    expect(porReserva.body).toHaveLength(1);
    pkg = await http.get(`/api/v1/packages/${pkgId}`).set(auth(ESTUDIANTE, "student")).expect(200);
    expect(pkg.body.hours_remaining).toBe(1);

    // CANCELAR la reserva con paquete: la hora se devuelve y queda un reembolso automático
    await servicio.refundForBookingCancelled(reservaPaquete);
    pkg = await http.get(`/api/v1/packages/${pkgId}`).set(auth(ESTUDIANTE, "student")).expect(200);
    expect(pkg.body.hours_remaining).toBe(2);
    expect(events.calls.map((c: any) => c.event)).toEqual(expect.arrayContaining(["publishPaymentSucceeded", "publishPaymentRefunded"]));

    // RESERVA 2 de otro estudiante (sin paquete): cobro individual con comisión 15%
    const reservaSuelta = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const t2 = await servicio.chargeForBookingConfirmed({ bookingId: reservaSuelta, studentId: OTRO_ESTUDIANTE, tutorProfileId: "perfil-1", priceSnapshot: 100000 });
    const cobro = await http.get(`/api/v1/transactions/${t2!.id}`).set(auth(OTRO_ESTUDIANTE, "student")).expect(200);
    expect(cobro.body).toMatchObject({
      tutor_id: TUTOR,
      status: "succeeded",
      amount: "100000.00",
      commission_amount: "15000.00",
      tutor_net_amount: "85000.00",
      gateway_reference: `booking-${reservaSuelta}`,
    });

    // REEMBOLSO MANUAL: solo admin; parcial válido; exceso -> 409
    await http.post(`/api/v1/transactions/${t2!.id}/refund`).set(auth(OTRO_ESTUDIANTE, "student")).send({ amount: 10000 }).expect(403);
    await http.post(`/api/v1/transactions/${t2!.id}/refund`).set(auth(ADMIN, "admin")).send({ amount: 30000 }).expect(201);
    await http.post(`/api/v1/transactions/${t2!.id}/refund`).set(auth(ADMIN, "admin")).send({ amount: 80000 }).expect(409);
    const reembolsos = await http.get(`/api/v1/transactions/${t2!.id}/refunds`).set(auth(ADMIN, "admin")).expect(200);
    expect(reembolsos.body).toHaveLength(1);
    expect(reembolsos.body[0].amount).toBe("30000.00");

    // LIQUIDACIÓN del tutor: 85000 neto - 30000 reembolsado; un tutor ajeno no puede verla
    const liquidacion = await http.get(`/api/v1/settlements/tutor/${TUTOR}`).set(auth(TUTOR, "tutor")).expect(200);
    expect(liquidacion.body).toMatchObject({
      transactionsCount: 2, // la reserva cubierta por paquete también genera una transacción (monto 0)
      grossAmount: 100000,
      commissionRetained: 15000,
      refundedAmount: 30000,
      netPayable: 55000,
    });
    await http.get(`/api/v1/settlements/tutor/${TUTOR}`).set(auth("55555555-5555-4555-8555-555555555555", "tutor")).expect(403);
  });
});

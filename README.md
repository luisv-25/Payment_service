# payment-service

Paquetes de horas, pagos con PayPal, comisiones, liquidaciones y pagos a tutores.

Parte de **EduConecta** (plataforma de tutorías, arquitectura de microservicios). Stack: NestJS · TypeORM · PostgreSQL · RabbitMQ.

## Requisitos
- Node.js 20+
- PostgreSQL 14+ (local o Neon)
- RabbitMQ (CloudAMQP o local)

## Puesta en marcha
```bash
cd payment-service
cp .env.example .env   # completar valores
npm install
npm run start:dev      # desarrollo
npm run build && npm start   # producción
```
El servicio escucha en `PORT` (por defecto 5437). Salud: `GET /health` y `GET /ready`; métricas: `GET /metrics`.

## Variables de entorno
Ver `.env.example`. Todos los servicios que validan JWT deben usar el **mismo** `JWT_SECRET` (y el gateway también).

## Endpoints
| Método | Ruta |
|---|---|
| POST | `/api/v1/packages` |
| GET | `/api/v1/packages` |
| GET | `/api/v1/packages/:id` |
| GET | `/api/v1/payouts/open` |
| GET | `/api/v1/payouts/open/tutor/:tutorId` |
| POST | `/api/v1/payouts/generate` |
| GET | `/api/v1/payouts` |
| POST | `/api/v1/payouts/:id/paid` |
| GET | `/api/v1/paypal/status` |
| POST | `/api/v1/transactions/:id/paypal/order` |
| POST | `/api/v1/transactions/:id/paypal/capture` |
| GET | `/api/v1/transactions` |
| GET | `/api/v1/transactions/:id` |
| GET | `/api/v1/transactions/:id/refunds` |
| POST | `/api/v1/transactions/:id/refund` |
| GET | `/api/v1/settlements/tutor/:tutorId` |
| GET | `/api/v1/settlements` |

## Mensajería (RabbitMQ)
- Colas: `notification_events_queue`, `payment_analytics_queue`, `payment_events_queue`
- Consume: `booking.cancelled`, `booking.confirmed`
- Publica: `package.low_balance`, `payment.failed`, `payment.refunded`, `payment.succeeded`


## Pruebas
```bash
npm run test:unit
npm run test:integration   # requiere PostgreSQL (TEST_DB_PASSWORD)
```
CI/CD: GitHub Actions (`.github/workflows/ci.yml` y `deploy.yml`, despliegue a Render por Deploy Hook).

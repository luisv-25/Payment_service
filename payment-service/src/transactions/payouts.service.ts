import { ConflictException, Injectable, Logger, NotFoundException, OnModuleInit } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface OpenBalance {
  tutorId: string;
  transactionsCount: number;
  grossAmount: number;
  commissionRetained: number;
  refundedAmount: number; // parte del tutor en los reembolsos aún no descontados
  netPayable: number;
}

// Liquidación periódica de tutores. Cada corte agrupa los cobros exitosos de
// sesiones (y los reembolsos) que todavía no se han liquidado, crea un
// registro "pendiente de pago" y los marca como liquidados (tutor_settlement_lines,
// UNIQUE por cobro/reembolso: nada se liquida dos veces). Después un admin
// registra el pago real al tutor ("paid" + referencia de la transferencia).
// Un reembolso posterior a una liquidación ya hecha se descuenta en la siguiente.
@Injectable()
export class PayoutsService implements OnModuleInit {
  private readonly logger = new Logger(PayoutsService.name);

  constructor(private readonly dataSource: DataSource) {}

  // Corte semanal automático (opcional, SETTLEMENT_AUTO=true): cada hora
  // revisa si ya es lunes (hora de Colombia) y aún no hubo corte esta semana.
  // Es idempotente, así que repetirlo o que el servicio duerma no hace daño;
  // el botón del admin siempre está como respaldo.
  onModuleInit() {
    if (process.env.SETTLEMENT_AUTO !== "true") return;
    const timer = setInterval(() => this.autoRun().catch((e) => this.logger.error(e.message)), 60 * 60 * 1000);
    timer.unref();
    this.autoRun().catch((e) => this.logger.error(e.message));
  }

  private async autoRun() {
    const bogota = new Date(Date.now() - 5 * 3600 * 1000);
    if (bogota.getUTCDay() !== 1) return; // lunes
    const monday = new Date(Date.UTC(bogota.getUTCFullYear(), bogota.getUTCMonth(), bogota.getUTCDate(), 5, 0, 0));
    const [{ n }] = await this.dataSource.query(`SELECT COUNT(*)::int AS n FROM tutor_settlements WHERE created_at >= $1`, [monday]);
    if (n > 0) return;
    const created = await this.generate();
    this.logger.log(`Corte semanal automático: ${created.length} liquidación(es) creada(s)`);
  }

  private async openItems(manager: EntityManager, tutorId?: string) {
    const params: unknown[] = tutorId ? [tutorId] : [];
    const filter = tutorId ? "AND t.tutor_id = $1" : "";
    const charges = await manager.query(
      `SELECT t.id, t.tutor_id, t.amount::float AS amount, t.commission_amount::float AS commission, t.tutor_net_amount::float AS net, t.created_at
         FROM transactions t
        WHERE t.status = 'succeeded' AND t.tutor_id IS NOT NULL AND t.amount > 0 ${filter}
          AND NOT EXISTS (SELECT 1 FROM tutor_settlement_lines l WHERE l.kind = 'charge' AND l.ref_id = t.id)`,
      params,
    );
    const refunds = await manager.query(
      `SELECT r.id, t.tutor_id, ROUND(r.amount * t.tutor_net_amount / t.amount, 2)::float AS share
         FROM refunds r JOIN transactions t ON t.id = r.transaction_id
        WHERE t.tutor_id IS NOT NULL AND t.amount > 0 ${filter}
          AND NOT EXISTS (SELECT 1 FROM tutor_settlement_lines l WHERE l.kind = 'refund' AND l.ref_id = r.id)`,
      params,
    );
    return { charges, refunds };
  }

  private groupByTutor(items: { charges: any[]; refunds: any[] }): Map<string, any> {
    const map = new Map<string, any>();
    const get = (id: string) => {
      if (!map.has(id)) map.set(id, { tutorId: id, charges: [], refunds: [] });
      return map.get(id);
    };
    items.charges.forEach((c) => get(c.tutor_id).charges.push(c));
    items.refunds.forEach((r) => get(r.tutor_id).refunds.push(r));
    return map;
  }

  private summarize(g: { tutorId: string; charges: any[]; refunds: any[] }): OpenBalance {
    const net = g.charges.reduce((s, c) => s + c.net, 0);
    const refunded = g.refunds.reduce((s, r) => s + r.share, 0);
    return {
      tutorId: g.tutorId,
      transactionsCount: g.charges.length,
      grossAmount: round2(g.charges.reduce((s, c) => s + c.amount, 0)),
      commissionRetained: round2(g.charges.reduce((s, c) => s + c.commission, 0)),
      refundedAmount: round2(refunded),
      netPayable: round2(net - refunded),
    };
  }

  // Saldo pendiente de liquidar (lo cobrado y aún no incluido en ningún corte).
  async openBalances(): Promise<OpenBalance[]> {
    const groups = this.groupByTutor(await this.openItems(this.dataSource.manager));
    return [...groups.values()].map((g) => this.summarize(g));
  }

  async openBalanceForTutor(tutorId: string): Promise<OpenBalance> {
    const groups = this.groupByTutor(await this.openItems(this.dataSource.manager, tutorId));
    return groups.get(tutorId)
      ? this.summarize(groups.get(tutorId))
      : { tutorId, transactionsCount: 0, grossAmount: 0, commissionRetained: 0, refundedAmount: 0, netPayable: 0 };
  }

  // Hace el corte: una liquidación pendiente por cada tutor con saldo > 0
  // (si el neto es <= 0, p. ej. por un reembolso grande, se arrastra al
  // siguiente corte). Todo en una transacción con candado, para que dos
  // cortes simultáneos no dupliquen nada.
  async generate(tutorId?: string) {
    return this.dataSource.transaction(async (manager) => {
      await manager.query(`SELECT pg_advisory_xact_lock(727001)`);
      const groups = this.groupByTutor(await this.openItems(manager, tutorId));
      const created: any[] = [];
      for (const g of groups.values()) {
        const s = this.summarize(g);
        if (s.netPayable <= 0) continue;
        const periodStart = g.charges.length
          ? g.charges.reduce((m: Date, c: any) => (c.created_at < m ? c.created_at : m), g.charges[0].created_at)
          : new Date();
        const [row] = await manager.query(
          `INSERT INTO tutor_settlements
             (tutor_id, period_start, period_end, transactions_count, gross_amount, commission_amount, refunded_amount, net_amount)
           VALUES ($1, $2, now(), $3, $4, $5, $6, $7) RETURNING *`,
          [g.tutorId, periodStart, s.transactionsCount, s.grossAmount, s.commissionRetained, s.refundedAmount, s.netPayable],
        );
        for (const c of g.charges) {
          await manager.query(`INSERT INTO tutor_settlement_lines (settlement_id, kind, ref_id, amount) VALUES ($1, 'charge', $2, $3)`, [row.id, c.id, c.net]);
        }
        for (const r of g.refunds) {
          await manager.query(`INSERT INTO tutor_settlement_lines (settlement_id, kind, ref_id, amount) VALUES ($1, 'refund', $2, $3)`, [row.id, r.id, -r.share]);
        }
        created.push(this.format(row));
      }
      return created;
    });
  }

  async list(filter: { tutorId?: string; status?: string }) {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.tutorId) {
      params.push(filter.tutorId);
      where.push(`tutor_id = $${params.length}`);
    }
    if (filter.status === "pending" || filter.status === "paid") {
      params.push(filter.status);
      where.push(`status = $${params.length}`);
    }
    const rows = await this.dataSource.query(
      `SELECT * FROM tutor_settlements ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY created_at DESC LIMIT 200`,
      params,
    );
    return rows.map((r: any) => this.format(r));
  }

  // El admin registra que ya transfirió el dinero al tutor.
  async markPaid(id: string, reference?: string) {
    // En Postgres, TypeORM devuelve [filas, cantidad] para un UPDATE ... RETURNING.
    const result = await this.dataSource.query(
      `UPDATE tutor_settlements SET status = 'paid', paid_at = now(), payment_reference = $2
        WHERE id = $1 AND status = 'pending' RETURNING *`,
      [id, reference?.trim() || null],
    );
    const rows: any[] = Array.isArray(result[0]) ? result[0] : result;
    if (rows.length) return this.format(rows[0]);
    const [exists] = await this.dataSource.query(`SELECT status FROM tutor_settlements WHERE id = $1`, [id]);
    if (!exists) throw new NotFoundException("Liquidación no encontrada");
    throw new ConflictException("Esta liquidación ya fue marcada como pagada");
  }

  private format(r: any) {
    return {
      id: r.id,
      tutorId: r.tutor_id,
      periodStart: r.period_start,
      periodEnd: r.period_end,
      transactionsCount: Number(r.transactions_count),
      grossAmount: Number(r.gross_amount),
      commissionAmount: Number(r.commission_amount),
      refundedAmount: Number(r.refunded_amount),
      netAmount: Number(r.net_amount),
      status: r.status,
      paymentReference: r.payment_reference,
      paidAt: r.paid_at,
      createdAt: r.created_at,
    };
  }
}

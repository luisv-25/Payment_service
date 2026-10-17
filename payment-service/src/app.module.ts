import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { PackagesModule } from "./packages/packages.module";
import { TransactionsModule } from "./transactions/transactions.module";
import { EventsModule } from "./events/events.module";
import { Package } from "./packages/entities/package.entity";
import { Transaction } from "./transactions/entities/transaction.entity";
import { Refund } from "./refunds/entities/refund.entity";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRoot({
      type: "postgres",
      host: process.env.DB_HOST || "localhost",
      port: Number(process.env.DB_PORT) || 5437,
      username: process.env.DB_USER || "payment_svc",
      password: process.env.DB_PASSWORD || "payment_svc_pw",
      database: process.env.DB_NAME || "payment_db",
      // Mismo apagador que el resto de los servicios para el despliegue en
      // Neon (sección de DevOps): en Neon se corre primero el DDL a mano y
      // se despliega con DB_SYNCHRONIZE=false; localmente/primer deploy
      // contra una base vacía puede quedar en true sin riesgo.
      ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
      entities: [Package, Transaction, Refund],
      synchronize: process.env.DB_SYNCHRONIZE !== "false",
    }),
    EventsModule,
    PackagesModule,
    TransactionsModule,
  ],
})
export class AppModule {}

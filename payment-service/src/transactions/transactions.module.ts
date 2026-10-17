import { Module, forwardRef } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { HttpModule } from "@nestjs/axios";
import { Transaction } from "./entities/transaction.entity";
import { Package } from "../packages/entities/package.entity";
import { Refund } from "../refunds/entities/refund.entity";
import { TransactionsService } from "./transactions.service";
import { TransactionsController } from "./transactions.controller";
import { GatewayClient } from "./gateway.client";
import { CatalogServiceClient } from "./catalog-service.client";
import { EventsModule } from "../events/events.module";
import { JwtConfigModule } from "../common/jwt-config.module";

@Module({
  imports: [
    TypeOrmModule.forFeature([Transaction, Package, Refund]),
    HttpModule,
    // Dependencia circular con EventsModule: TransactionsService publica
    // payment.* y los consumers de booking.confirmed/cancelled (en
    // EventsModule) necesitan TransactionsService -- mismo patrón que
    // RoomsModule/EventsModule en session-service.
    forwardRef(() => EventsModule),
    JwtConfigModule,
  ],
  providers: [TransactionsService, GatewayClient, CatalogServiceClient],
  controllers: [TransactionsController],
  exports: [TransactionsService],
})
export class TransactionsModule {}

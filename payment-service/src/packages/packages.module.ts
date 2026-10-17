import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Package } from "./entities/package.entity";
import { PackagesService } from "./packages.service";
import { PackagesController } from "./packages.controller";
import { TransactionsModule } from "../transactions/transactions.module";
import { JwtConfigModule } from "../common/jwt-config.module";

@Module({
  imports: [TypeOrmModule.forFeature([Package]), TransactionsModule, JwtConfigModule],
  providers: [PackagesService],
  controllers: [PackagesController],
})
export class PackagesModule {}

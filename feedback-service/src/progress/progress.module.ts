import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ProgressNote } from "./entities/progress-note.entity";
import { ProgressService } from "./progress.service";
import { ProgressController } from "./progress.controller";
import { JwtConfigModule } from "../common/jwt-config.module";

@Module({
  imports: [TypeOrmModule.forFeature([ProgressNote]), JwtConfigModule],
  providers: [ProgressService],
  controllers: [ProgressController],
})
export class ProgressModule {}

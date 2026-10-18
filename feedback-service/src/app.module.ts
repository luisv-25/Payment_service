import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { RatingsModule } from "./ratings/ratings.module";
import { ProgressModule } from "./progress/progress.module";
import { EventsModule } from "./events/events.module";
import { Rating } from "./ratings/entities/rating.entity";
import { ProgressNote } from "./progress/entities/progress-note.entity";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRoot({
      type: "postgres",
      host: process.env.DB_HOST || "localhost",
      port: Number(process.env.DB_PORT) || 5438,
      username: process.env.DB_USER || "feedback_svc",
      password: process.env.DB_PASSWORD || "feedback_svc_pw",
      database: process.env.DB_NAME || "feedback_db",
      ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
      entities: [Rating, ProgressNote],
      synchronize: process.env.DB_SYNCHRONIZE !== "false",
    }),
    EventsModule,
    RatingsModule,
    ProgressModule,
  ],
})
export class AppModule {}

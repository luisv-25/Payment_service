import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";

// Mismo JWT_SECRET compartido que el resto de los microservicios.
@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET || "dev_secret_change_me",
    }),
  ],
  exports: [JwtModule],
})
export class JwtConfigModule {}

import { IsNumber, IsOptional, IsString, Min } from "class-validator";

export class RefundTransactionDto {
  // Si se omite, se reembolsa el saldo restante de la transacción
  // (soporta reembolsos parciales, sección 5.5 del documento).
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  amount?: number;

  @IsOptional()
  @IsString()
  reason?: string;
}

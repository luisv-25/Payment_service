import { IsInt, IsNumber, Max, Min } from "class-validator";

export class CreatePackageDto {
  @IsInt()
  @Min(1)
  @Max(200)
  hoursPurchased: number;

  // Monto total cobrado por el paquete completo (no por hora).
  @IsNumber()
  @Min(0)
  amount: number;
}

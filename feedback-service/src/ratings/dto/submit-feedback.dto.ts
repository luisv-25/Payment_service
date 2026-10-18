import { IsInt, IsOptional, IsString, IsUUID, Max, Min } from "class-validator";

export class SubmitFeedbackDto {
  @IsUUID()
  bookingId: string;

  @IsInt()
  @Min(1)
  @Max(5)
  score: number;

  @IsOptional()
  @IsString()
  comment?: string;
}

import { IsString, IsUUID, MinLength } from "class-validator";

export class CreateProgressNoteDto {
  @IsUUID()
  subjectId: string;

  @IsString()
  @MinLength(1)
  note: string;
}

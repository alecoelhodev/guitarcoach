import { ArrayMinSize, IsArray, IsUUID } from 'class-validator';

export class ReorderRoutineTasksDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  taskIds: string[];
}

import { Transform } from 'class-transformer';
import { IsBoolean, IsString, Length, ValidateIf } from 'class-validator';

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

// Single DTO for the one endpoint's two request shapes: a new prompt, or a
// confirmation/decline referencing a previous plan. class-validator can only
// express per-field shape here (via @ValidateIf) -- the cross-field "exactly
// one of prompt XOR (confirmation + previousResponseId)" business rule is
// enforced in AiPracticePlannerService.handleRequest, not here, per this
// repo's "business logic lives in the service" convention.
export class PracticePlannerRequestDto {
  @ValidateIf((o: PracticePlannerRequestDto) => o.confirmation === undefined)
  @Transform(trim)
  @IsString()
  @Length(1, 2000)
  prompt?: string;

  @ValidateIf((o: PracticePlannerRequestDto) => o.prompt === undefined)
  @IsBoolean()
  confirmation?: boolean;

  @ValidateIf((o: PracticePlannerRequestDto) => o.confirmation !== undefined)
  @IsString()
  previousResponseId?: string;
}

import { IsString, IsEnum, IsOptional, MaxLength } from 'class-validator';
import { ReportTargetType, ReportReason } from '../../generated/prisma/enums';

export class CreateReportDto {
  @IsEnum(ReportTargetType)
  targetType: ReportTargetType;

  @IsString()
  targetId: string;

  @IsOptional()
  @IsString()
  bookingId?: string;

  @IsEnum(ReportReason)
  reason: ReportReason;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}

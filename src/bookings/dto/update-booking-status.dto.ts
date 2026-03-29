import { IsEnum } from 'class-validator';
import { BookingStatus } from '../../generated/prisma/enums';

export class UpdateBookingStatusDto {
  @IsEnum(BookingStatus)
  status: BookingStatus;
}

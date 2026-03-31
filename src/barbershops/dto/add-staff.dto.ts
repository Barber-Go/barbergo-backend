import { IsOptional, IsString } from 'class-validator';

export class AddStaffDto {
  @IsString()                barberProfileId: string;
  @IsOptional() @IsString()  role?: string;
}

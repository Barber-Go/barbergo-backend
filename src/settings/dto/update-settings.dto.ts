import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class UpdateSettingsDto {
  @IsOptional() @IsBoolean() pushNotifications?: boolean;
  @IsOptional() @IsBoolean() emailNotifications?: boolean;
  @IsOptional() @IsString()  language?: string;
  @IsOptional() @IsString()  currency?: string;
}

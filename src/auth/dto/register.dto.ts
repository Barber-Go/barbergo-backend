import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';
import { Role } from '../../generated/prisma/enums';

export class RegisterDto {
  @IsString()
  name: string;

  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  password: string;

  @IsEnum([Role.CLIENT, Role.BARBER, Role.BARBER_INDEPENDENT, Role.BARBER_EMPLOYEE, Role.BARBERSHOP_OWNER], {
    message: 'role must be CLIENT, BARBER_INDEPENDENT, BARBER_EMPLOYEE, or BARBERSHOP_OWNER',
  })
  role: Role;

  // ── Role-specific fields ──

  /** BARBER_INDEPENDENT: optional specialty */
  @IsOptional()
  @IsString()
  specialty?: string;

  /** BARBERSHOP_OWNER: shop details */
  @IsOptional()
  @IsString()
  shopName?: string;

  @IsOptional()
  @IsString()
  shopAddress?: string;

  @IsOptional()
  @IsString()
  shopPhone?: string;

  /** BARBER_EMPLOYEE: optional invite code to join a barbershop */
  @IsOptional()
  @IsString()
  inviteCode?: string;
}

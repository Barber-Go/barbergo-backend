import { IsBoolean, IsEnum, IsOptional, IsString, Matches } from 'class-validator';

export class UpdateTaxProfileDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d{1,2}\.\d{3}\.\d{3}-[\dkK]$/, { message: 'RUT inválido' })
  rut?: string;

  @IsOptional()
  @IsString()
  razonSocial?: string;

  @IsOptional()
  @IsString()
  giro?: string;

  @IsOptional()
  @IsEnum(['14A', '14D3', '14D8'])
  regimenTributario?: string;

  @IsOptional()
  @IsBoolean()
  vatAffectation?: boolean;

  @IsOptional()
  @IsBoolean()
  issuesDte?: boolean;

  @IsOptional()
  @IsBoolean()
  hasEmployees?: boolean;

  @IsOptional()
  @IsBoolean()
  withholdsHonorarios?: boolean;

  @IsOptional()
  @IsString()
  monthlyRevenue?: string;
}

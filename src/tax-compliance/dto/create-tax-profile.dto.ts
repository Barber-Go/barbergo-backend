import { IsBoolean, IsDateString, IsEnum, IsInt, IsOptional, IsString, Matches } from 'class-validator';

export class CreateTaxProfileDto {
  @IsString()
  @Matches(/^\d{1,2}\.\d{3}\.\d{3}-[\dkK]$/, { message: 'RUT inválido. Formato: XX.XXX.XXX-X' })
  rut: string;

  @IsString()
  razonSocial: string;

  @IsOptional()
  @IsString()
  giro?: string;

  @IsEnum(['14A', '14D3', '14D8'], { message: 'Régimen debe ser 14A, 14D3 o 14D8' })
  regimenTributario: string;

  @IsBoolean()
  vatAffectation: boolean;

  @IsBoolean()
  issuesDte: boolean;

  @IsBoolean()
  hasEmployees: boolean;

  @IsBoolean()
  withholdsHonorarios: boolean;

  @IsOptional()
  @IsString()
  monthlyRevenue?: string;

  @IsOptional()
  @IsString()
  pfxCertificateBase64?: string;

  @IsOptional()
  @IsString()
  pfxPassword?: string;

  @IsOptional()
  @IsInt()
  siiResolucionNumero?: number;

  @IsOptional()
  @IsDateString()
  siiResolucionFecha?: string;

  @IsOptional()
  @IsString()
  comunaSii?: string;

  @IsOptional()
  @IsString()
  direccionSii?: string;

  @IsOptional()
  @IsInt()
  actividadEconomica?: number;
}

import { IsEnum, IsOptional, IsString, Matches } from 'class-validator';

export enum TipoContribuyente {
  PERSONA_NATURAL = 'PERSONA_NATURAL',
  SOCIEDAD_SPA = 'SOCIEDAD_SPA',
  SOCIEDAD_EIRL = 'SOCIEDAD_EIRL',
}

export enum SiiClaveType {
  TRIBUTARIA = 'tributaria',
  CLAVE_UNICA = 'clave_unica',
}

export class SaveCredentialsDto {
  @IsEnum(TipoContribuyente, {
    message: 'tipoContribuyente debe ser PERSONA_NATURAL, SOCIEDAD_SPA o SOCIEDAD_EIRL',
  })
  tipoContribuyente: TipoContribuyente;

  @IsString()
  @Matches(/^\d{1,2}\.\d{3}\.\d{3}-[\dkK]$/, {
    message: 'RUT inválido. Formato: XX.XXX.XXX-X',
  })
  rut: string;

  @IsOptional()
  @IsEnum(SiiClaveType, {
    message: 'siiClaveType debe ser tributaria o clave_unica',
  })
  siiClaveType?: SiiClaveType;

  @IsOptional()
  @IsString()
  siiClave?: string;

  @IsOptional()
  @IsString()
  pfxCertificateBase64?: string;

  @IsOptional()
  @IsString()
  pfxPassword?: string;
}

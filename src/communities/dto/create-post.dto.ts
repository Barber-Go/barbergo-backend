import { IsOptional, IsString, IsUrl } from 'class-validator';

export class CreatePostDto {
  @IsOptional() @IsString()  title?: string;
  @IsString()                body: string;
  @IsOptional() @IsUrl()     imageUrl?: string;
}

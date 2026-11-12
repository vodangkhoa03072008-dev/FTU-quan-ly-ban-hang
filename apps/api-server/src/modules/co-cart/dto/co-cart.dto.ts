import { IsString, MaxLength, MinLength } from 'class-validator';

export class CartIdDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  cartId: string;
}

export class VerifyClaimDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  qrToken: string;
}

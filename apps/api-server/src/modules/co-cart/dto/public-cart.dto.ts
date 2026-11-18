import { Exclude, Expose, Type } from 'class-transformer';
import { CartStatus, MemberRole } from '@prisma/client';

/**
 * Mọi DTO đầu ra đặt @Exclude() ở cấp class: chỉ trường @Expose() mới được đi ra.
 * Nhờ vậy userId, fullName, phoneNumber, roomAddress, pickupTokenHash... không bao giờ lộ.
 */
@Exclude()
export class PublicCartItemDto {
  @Expose() id: string;
  @Expose() productId: string;
  @Expose() productName: string;
  @Expose() unitPrice: number;
  @Expose() quantity: number;
  @Expose() note?: string;
}

@Exclude()
export class PublicCartMemberDto {
  @Expose() id: string;
  @Expose() role: MemberRole;
  @Expose() aliasName: string;
  @Expose() avatarColor: string;
  @Expose() avatarSeed: string;
  @Expose() subtotal: number;
  @Expose() shippingShare: number;
  @Expose() discountShare: number;
  @Expose() finalPayable: number;
  @Expose() isPaid: boolean;
  @Expose() pickedUpAt?: Date;

  @Expose()
  @Type(() => PublicCartItemDto)
  items: PublicCartItemDto[];
}

@Exclude()
export class PublicCoCartResponseDto {
  @Expose() id: string;
  @Expose() joinCode: string;
  @Expose() isPublic: boolean;
  @Expose() shippingMode: string;
  @Expose() hubId: string;
  @Expose() merchantId: string;
  @Expose() status: CartStatus;
  @Expose() baseShippingFee: number;
  @Expose() discountAmount: number;
  @Expose() expiresAt: Date;
  @Expose() pickupLabel?: string;
  @Expose() maxMembers: number;
  @Expose() requireApproval: boolean;
  @Expose() rules?: string;

  @Expose()
  @Type(() => PublicCartMemberDto)
  members: PublicCartMemberDto[];
}

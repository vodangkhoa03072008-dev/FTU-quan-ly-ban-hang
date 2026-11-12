import { randomInt, createHash } from 'crypto';
import { secret } from '../../../common/env';

const ANIMALS = ['Gấu Trúc', 'Cáo Nhỏ', 'Cú Đêm', 'Sóc Bay', 'Mèo Máy', 'Rái Cá', 'Hải Âu', 'Thỏ Trắng'];
const TRAITS = ['Thông Thái', 'Tốc Độ', 'Ẩn Danh', 'Xanh Lá', 'Vui Vẻ', 'Tinh Nhuệ', 'Thân Thiện'];
const COLORS = ['#10B981', '#3B82F6', '#8B5CF6', '#EC4899', '#F59E0B', '#06B6D4', '#EF4444'];

export function generateAnonymousPersona(cartId: string, userId: string, existingAliases: string[]) {
  const salt = secret('ALIAS_SALT', 'dev-only-alias-salt');
  const avatarSeed = createHash('sha256')
    .update(`${cartId}:${userId}:${salt}`)
    .digest('hex')
    .substring(0, 12);

  let aliasName = '';
  let attempts = 0;
  do {
    const animal = ANIMALS[randomInt(0, ANIMALS.length)];
    const trait = TRAITS[randomInt(0, TRAITS.length)];
    const number = randomInt(10, 100);
    aliasName = `${animal} ${trait} #${number}`;
    attempts++;
  } while (existingAliases.includes(aliasName) && attempts < 50);

  const avatarColor = COLORS[randomInt(0, COLORS.length)];
  return { aliasName, avatarColor, avatarSeed };
}

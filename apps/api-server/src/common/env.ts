export const isProd = () => process.env.NODE_ENV === 'production';

/** Lấy secret từ env. Ở production bắt buộc phải cấu hình, không có giá trị mặc định. */
export function secret(name: string, devDefault: string): string {
  const v = process.env[name];
  if (v) return v;
  if (isProd()) throw new Error(`Thiếu biến môi trường bắt buộc: ${name}`);
  return devDefault;
}

/** Tính năng chỉ dành cho demo (đăng nhập giả lập, thanh toán nhanh). Luôn tắt ở production. */
export const demoEnabled = () => !isProd() && process.env.ALLOW_DEMO_PAYMENT === 'true';

export const frontendUrl = () => process.env.FRONTEND_URL || 'http://localhost:3000';

import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Co-Cart — Giỏ hàng ghép ẩn danh & vận chuyển xanh',
  description: 'Ghép chung giỏ hàng theo thời gian thực, ẩn danh 100%, giảm phí ship và phát thải CO₂.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const users = [
    { id: 'user-sv-1', email: 'sv1@gm.uit.edu.vn', fullName: 'Nguyễn Văn A (PII - Bị Ẩn)', phoneNumber: '0901234567', roomAddress: 'P.402, Tòa BA4, KTX Khu B' },
    { id: 'user-sv-2', email: 'sv2@gm.uit.edu.vn', fullName: 'Trần Thị B (PII - Bị Ẩn)', phoneNumber: '0902345678', roomAddress: 'P.510, Tòa BA5, KTX Khu B' },
    { id: 'user-sv-3', email: 'sv3@gm.uit.edu.vn', fullName: 'Lê Hoàng C (PII - Bị Ẩn)', phoneNumber: '0903456789', roomAddress: 'P.201, Tòa BA1, KTX Khu B' },
  ];
  for (const u of users) {
    await prisma.user.upsert({ where: { id: u.id }, update: u, create: u });
  }

  const hubs = [
    { id: 'hub-ktx-khu-b', name: 'Điểm nhận hàng - Cổng Chính KTX Khu B', zoneCode: 'KTX-KHU-B', latitude: 10.8825, longitude: 106.7825 },
    { id: 'hub-ktx-cong-sau', name: 'Điểm nhận hàng - Cổng Sau KTX', zoneCode: 'KTX-CONG-SAU', latitude: 10.887, longitude: 106.779 },
  ];
  for (const h of hubs) {
    await prisma.pickupHub.upsert({ where: { id: h.id }, update: { name: h.name }, create: h });
  }

  // Phạm vi MVP theo đề án: đồ uống đóng chai, thực phẩm đóng gói, snack, văn phòng phẩm, hàng tiêu dùng nhỏ.
  // Không có đồ ăn nóng/lạnh, hàng giá trị cao hay giỏ nhiều cửa hàng.
  await prisma.merchant.upsert({
    where: { id: 'merchant-tap-hoa-01' },
    update: { name: 'Tạp Hóa & Văn Phòng Phẩm Làng Đại Học' },
    create: { id: 'merchant-tap-hoa-01', name: 'Tạp Hóa & Văn Phòng Phẩm Làng Đại Học', baseShippingFee: 30000 },
  });

  const products = [
    { id: 'tp-1', merchantId: 'merchant-tap-hoa-01', name: 'Nước suối 500ml (lốc 6 chai)', price: 36000 },
    { id: 'tp-2', merchantId: 'merchant-tap-hoa-01', name: 'Trà xanh đóng chai 455ml', price: 10000 },
    { id: 'tp-3', merchantId: 'merchant-tap-hoa-01', name: 'Mì ly đóng gói (thùng 6 ly)', price: 66000 },
    { id: 'tp-4', merchantId: 'merchant-tap-hoa-01', name: 'Snack khoai tây 54g', price: 12000 },
    { id: 'tp-5', merchantId: 'merchant-tap-hoa-01', name: 'Bánh quy bơ hộp nhỏ', price: 28000 },
    { id: 'tp-6', merchantId: 'merchant-tap-hoa-01', name: 'Bút bi (hộp 10 cây)', price: 40000 },
    { id: 'tp-7', merchantId: 'merchant-tap-hoa-01', name: 'Vở kẻ ngang 200 trang (lốc 5 quyển)', price: 75000 },
  ];
  for (const p of products) {
    await prisma.product.upsert({ where: { id: p.id }, update: p, create: p });
  }

  console.log('✅ Khởi tạo dữ liệu mẫu Co-Cart hoàn tất!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

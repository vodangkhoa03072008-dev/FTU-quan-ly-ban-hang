'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Eye, EyeOff } from 'lucide-react';
import { login } from '../../lib/api';

const SAMPLE = { email: 'sv1@gm.uit.edu.vn', password: 'cocart2026' };

export default function LoginPage() {
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function doLogin(email: string, password: string) {
    setBusy(true);
    setMessage('');
    try {
      await login(email, password);
      router.push('/');
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    doLogin(String(data.get('email') ?? ''), String(data.get('password') ?? ''));
  }

  return (
    <main className="min-h-screen [&_button]:min-h-11 [&_button:disabled]:cursor-not-allowed [&_:focus-visible]:outline [&_:focus-visible]:outline-2 [&_:focus-visible]:outline-offset-2 [&_:focus-visible]:outline-[#2F855A] bg-[#FFF8F0] px-4 py-8 text-[#25312B] sm:px-8">
      <div className="mx-auto max-w-5xl">
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-lg text-sm text-[#626860] transition hover:text-[#2F855A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F855A]"
        >
          <ArrowLeft size={18} aria-hidden="true" />
          Về trang chủ
        </Link>

        <div className="mt-10 grid overflow-hidden shadow-sm rounded-3xl border border-[#E8E2D9] bg-white md:mt-16 md:grid-cols-2">
          <section className="flex flex-col justify-center border-b border-[#E8E2D9] bg-gradient-to-br from-[#FFF0E5] to-white p-8 sm:p-10 md:border-b-0 md:border-r">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.jpg" alt="Co-Cart" className="mb-8 h-24 w-24 rounded-2xl" />

            <h1 className="text-3xl font-bold leading-tight sm:text-4xl">
              Giỏ hàng chung.
              <span className="mt-2 block text-[#2F855A]">
                Tiết kiệm cùng nhau.
              </span>
            </h1>

            <p className="mt-5 leading-relaxed text-[#626860]">
              Kết nối với những người cùng khu vực, chọn sản phẩm bạn cần
              và chia sẻ phí giao hàng tại điểm nhận chung.
            </p>

            <div className="mt-8 rounded-2xl border border-[#CDE2D3] bg-white/70 p-5">
              <p className="font-semibold text-[#2F855A]">
                Mua chung bằng biệt danh
              </p>
              <p className="mt-2 text-sm leading-relaxed text-[#626860]">
                Email dùng cho tài khoản. Trong nhóm mua chung, người khác
                chỉ cần nhìn thấy biệt danh của bạn.
              </p>
            </div>
          </section>

          <section aria-labelledby="login-heading" className="p-8 sm:p-10">
            <p className="text-sm font-medium text-[#2F855A]">
              CHÀO MỪNG BẠN TRỞ LẠI
            </p>

            <h2 id="login-heading" className="mt-3 text-3xl font-bold">
              Đăng nhập
            </h2>

            <p id="login-description" className="mt-3 text-sm text-[#626860]">
              Tài khoản mẫu: {SAMPLE.email} / {SAMPLE.password}
            </p>

            <form
              onSubmit={handleSubmit}
              aria-describedby="login-description"
              className="mt-8 space-y-5"
            >
              <div>
                <label
                  htmlFor="email"
                  className="mb-2 block text-sm font-medium text-[#25312B]"
                >
                  Email
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="username"
                  placeholder="ban@example.com"
                  required
                  className="w-full rounded-xl border border-[#D8D1C7] bg-[#FFF8F0] px-4 py-3 text-[#25312B] outline-none placeholder:text-[#626860] focus:border-[#2F855A] focus:ring-2 focus:ring-[#2F855A]/20"
                />
              </div>

              <div>
                <label
                  htmlFor="password"
                  className="mb-2 block text-sm font-medium text-[#25312B]"
                >
                  Mật khẩu
                </label>

                <div className="relative">
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    placeholder="Nhập mật khẩu"
                    required
                    className="w-full rounded-xl border border-[#D8D1C7] bg-[#FFF8F0] py-3 pl-4 pr-14 text-[#25312B] outline-none placeholder:text-[#626860] focus:border-[#2F855A] focus:ring-2 focus:ring-[#2F855A]/20"
                  />

                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                    aria-controls="password"
                    className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg text-[#626860] hover:text-[#2F855A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F855A]"
                  >
                    {showPassword ? (
                      <EyeOff size={20} aria-hidden="true" />
                    ) : (
                      <Eye size={20} aria-hidden="true" />
                    )}
                  </button>
                </div>
              </div>

              <button
                type="button"
                disabled={busy}
                onClick={() => doLogin(SAMPLE.email, SAMPLE.password)}
                className="w-full rounded-xl border border-[#2F855A] px-4 py-3 font-semibold text-[#2F855A] hover:bg-[#EAF4ED] disabled:opacity-50"
              >
                ⚡ Đăng nhập nhanh 1-click (Sinh viên mẫu)
              </button>

              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-xl bg-[#F9734B] px-4 py-3 font-semibold text-[#25312B] transition hover:bg-[#F58260] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F855A] focus-visible:ring-offset-2 focus-visible:ring-offset-white"
              >
                {busy ? 'Đang đăng nhập…' : 'Đăng nhập'}
              </button>

              <p
                role="status"
                className="text-sm leading-relaxed text-red-700"
              >
                {message}
              </p>
            </form>

            <p className="mt-6 border-t border-[#E8E2D9] pt-6 text-sm leading-relaxed text-[#626860]">
              Chưa có tài khoản?{' '}
              <Link
                href="/register"
                className="rounded font-semibold text-[#2F855A] underline underline-offset-4 hover:text-[#2F855A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F855A]"
              >
                Đăng ký
              </Link>
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
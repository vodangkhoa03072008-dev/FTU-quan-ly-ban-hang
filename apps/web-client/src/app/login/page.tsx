'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { ArrowLeft, Eye, EyeOff, ShoppingBag } from 'lucide-react';

export default function LoginPage() {
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState('');

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setMessage(
      'Thông tin đã qua kiểm tra định dạng. Đây là bản giao diện; chức năng đăng nhập chưa được kết nối.',
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100 sm:px-8">
      <div className="mx-auto max-w-5xl">
        <Link
          href="/"
          className="inline-flex items-center gap-2 rounded-lg text-sm text-slate-300 transition hover:text-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
        >
          <ArrowLeft size={18} aria-hidden="true" />
          Về trang chủ
        </Link>

        <div className="mt-10 grid overflow-hidden rounded-3xl border border-slate-800 bg-slate-900 md:mt-16 md:grid-cols-2">
          <section className="flex flex-col justify-center border-b border-slate-800 bg-gradient-to-br from-emerald-950 to-slate-900 p-8 sm:p-10 md:border-b-0 md:border-r">
            <div className="mb-8 flex items-center gap-3 text-emerald-400">
              <ShoppingBag size={30} aria-hidden="true" />
              <span className="text-2xl font-bold">Co-Cart</span>
            </div>

            <h1 className="text-3xl font-bold leading-tight sm:text-4xl">
              Giỏ hàng chung.
              <span className="mt-2 block text-emerald-400">
                Tiết kiệm cùng nhau.
              </span>
            </h1>

            <p className="mt-5 leading-relaxed text-slate-300">
              Kết nối với những người cùng khu vực, chọn sản phẩm bạn cần
              và chia sẻ phí giao hàng tại điểm nhận chung.
            </p>

            <div className="mt-8 rounded-2xl border border-emerald-800 bg-emerald-950/50 p-5">
              <p className="font-semibold text-emerald-300">
                Mua chung bằng biệt danh
              </p>
              <p className="mt-2 text-sm leading-relaxed text-slate-300">
                Email dùng cho tài khoản. Trong nhóm mua chung, người khác
                chỉ cần nhìn thấy biệt danh của bạn.
              </p>
            </div>
          </section>

          <section aria-labelledby="login-heading" className="p-8 sm:p-10">
            <p className="text-sm font-medium text-emerald-400">
              CHÀO MỪNG BẠN TRỞ LẠI
            </p>

            <h2 id="login-heading" className="mt-3 text-3xl font-bold">
              Đăng nhập
            </h2>

            <p id="login-description" className="mt-3 text-sm text-slate-400">
              Bản xem trước giao diện — chưa kết nối đăng nhập.
            </p>

            <form
              onSubmit={handleSubmit}
              aria-describedby="login-description"
              className="mt-8 space-y-5"
            >
              <div>
                <label
                  htmlFor="email"
                  className="mb-2 block text-sm font-medium text-slate-200"
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
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-100 outline-none placeholder:text-slate-500 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/20"
                />
              </div>

              <div>
                <label
                  htmlFor="password"
                  className="mb-2 block text-sm font-medium text-slate-200"
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
                    className="w-full rounded-xl border border-slate-700 bg-slate-950 py-3 pl-4 pr-14 text-slate-100 outline-none placeholder:text-slate-500 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/20"
                  />

                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                    aria-controls="password"
                    className="absolute right-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 hover:text-emerald-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
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
                type="submit"
                className="w-full rounded-xl bg-emerald-400 px-4 py-3 font-semibold text-slate-950 transition hover:bg-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
              >
                Đăng nhập
              </button>

              <p
                role="status"
                className="text-sm leading-relaxed text-emerald-300"
              >
                {message}
              </p>
            </form>

            <p className="mt-6 border-t border-slate-800 pt-6 text-sm leading-relaxed text-slate-400">
              Chưa có tài khoản?{' '}
              <Link
                href="/register"
                className="rounded font-semibold text-emerald-400 underline underline-offset-4 hover:text-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
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
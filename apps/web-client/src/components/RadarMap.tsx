'use client';

import React from 'react';

export interface RadarGroup {
  cartId: string;
  merchantName: string;
  pickupLabel: string;
  approxLat: number;
  approxLng: number;
  distanceMeters: number;
  membersCount: number;
  seatsLeft: number;
  isMine: boolean;
}

const M_PER_DEG = 111_320;

/** Bản đồ Radar: tâm là vị trí tìm kiếm, mỗi chấm là điểm nhận hàng (đã làm tròn ~110 m) của một nhóm công khai. */
export default function RadarMap({
  center,
  radius,
  groups,
  selected,
  onSelect,
}: {
  center: { lat: number; lng: number };
  radius: number;
  groups: RadarGroup[];
  selected?: string | null;
  onSelect: (cartId: string) => void;
}) {
  const project = (lat: number, lng: number) => {
    const dx = (lng - center.lng) * M_PER_DEG * Math.cos((center.lat * Math.PI) / 180);
    const dy = (lat - center.lat) * M_PER_DEG;
    const k = 90 / radius;
    return { x: Math.max(-95, Math.min(95, dx * k)), y: Math.max(-95, Math.min(95, -dy * k)) };
  };

  return (
    <svg viewBox="-100 -100 200 200" className="w-full max-w-md mx-auto aspect-square select-none">
      <defs>
        <radialGradient id="radarBg">
          <stop offset="0%" stopColor="#064e3b" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#020617" stopOpacity="0.9" />
        </radialGradient>
      </defs>
      <circle r="90" fill="url(#radarBg)" stroke="#10b981" strokeOpacity="0.5" />
      {[0.33, 0.66].map((f) => (
        <circle key={f} r={90 * f} fill="none" stroke="#10b981" strokeOpacity="0.2" strokeDasharray="2 3" />
      ))}
      <line x1="-90" y1="0" x2="90" y2="0" stroke="#10b981" strokeOpacity="0.12" />
      <line x1="0" y1="-90" x2="0" y2="90" stroke="#10b981" strokeOpacity="0.12" />
      <text x="0" y="-92" textAnchor="middle" fontSize="6" fill="#6ee7b7">
        {radius >= 1000 ? `${radius / 1000} km` : `${radius} m`}
      </text>

      <circle r="3.5" fill="#3b82f6" stroke="white" strokeWidth="1" />
      <text x="0" y="10" textAnchor="middle" fontSize="5" fill="#93c5fd">Bạn</text>

      {groups.map((g) => {
        const p = project(g.approxLat, g.approxLng);
        const active = selected === g.cartId;
        return (
          <g key={g.cartId} transform={`translate(${p.x} ${p.y})`} onClick={() => onSelect(g.cartId)} className="cursor-pointer">
            <circle r={active ? 7 : 5} fill={g.isMine ? '#f59e0b' : '#10b981'} fillOpacity="0.85" stroke="white" strokeWidth={active ? 1.2 : 0.6} />
            <text y="2" textAnchor="middle" fontSize="5" fontWeight="bold" fill="#022c22">
              {g.membersCount}
            </text>
            <text y="-8" textAnchor="middle" fontSize="4.5" fill="#e2e8f0">
              {g.merchantName.length > 18 ? `${g.merchantName.slice(0, 17)}…` : g.merchantName}
            </text>
            <title>{`${g.merchantName} · ${g.pickupLabel} · ~${g.distanceMeters} m · còn ${g.seatsLeft} chỗ`}</title>
          </g>
        );
      })}
    </svg>
  );
}

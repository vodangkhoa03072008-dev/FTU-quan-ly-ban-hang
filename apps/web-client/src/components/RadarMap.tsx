'use client';

import React, { useId } from 'react';

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
  const gradientId = useId();
  const project = (lat: number, lng: number) => {
    const dx = (lng - center.lng) * M_PER_DEG * Math.cos((center.lat * Math.PI) / 180);
    const dy = (lat - center.lat) * M_PER_DEG;
    const k = 90 / radius;
    return { x: Math.max(-95, Math.min(95, dx * k)), y: Math.max(-95, Math.min(95, -dy * k)) };
  };

  return (
    <svg viewBox="-100 -100 200 200" className="w-full max-w-md mx-auto aspect-square select-none" role="group" aria-label="Sơ đồ điểm nhận hàng gần vị trí tìm kiếm">
      <defs>
        <radialGradient id={gradientId}>
          <stop offset="0%" stopColor="#E0EFE2" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#FFF8F0" stopOpacity="0.9" />
        </radialGradient>
      </defs>
      <circle r="90" fill={`url(#${gradientId})`} stroke="#2F855A" strokeOpacity="0.5" />
      {[0.33, 0.66].map((f) => (
        <circle key={f} r={90 * f} fill="none" stroke="#2F855A" strokeOpacity="0.2" strokeDasharray="2 3" />
      ))}
      <line x1="-90" y1="0" x2="90" y2="0" stroke="#2F855A" strokeOpacity="0.12" />
      <line x1="0" y1="-90" x2="0" y2="90" stroke="#2F855A" strokeOpacity="0.12" />
      <text x="0" y="-92" textAnchor="middle" fontSize="6" fill="#2F855A">
        {radius >= 1000 ? `${radius / 1000} km` : `${radius} m`}
      </text>

      <circle r="3.5" fill="#3b82f6" stroke="white" strokeWidth="1" />
      <text x="0" y="10" textAnchor="middle" fontSize="5" fill="#24548A">Điểm tìm kiếm</text>

      {groups.map((g) => {
        const p = project(g.approxLat, g.approxLng);
        const active = selected === g.cartId;
        return (
          <g key={g.cartId} transform={`translate(${p.x} ${p.y})`} onClick={() => onSelect(g.cartId)} className="cursor-pointer focus:outline-none" role="button" tabIndex={0}
            aria-label={`${g.merchantName}, còn ${g.seatsLeft} chỗ${g.isMine ? ', nhóm của bạn' : ''}`}
            aria-pressed={active}
            onFocus={() => onSelect(g.cartId)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelect(g.cartId);
              }
            }}>
            <circle r={active ? 7 : 5} fill={g.isMine ? '#2F855A' : g.seatsLeft > 0 ? '#F9734B' : '#D8D1C7'} fillOpacity="0.85" stroke="white" strokeWidth={active ? 1.2 : 0.6} />
            <text y="2" textAnchor="middle" fontSize="5" fontWeight="bold" fill={g.isMine ? '#FFFFFF' : '#25312B'}>
              {g.membersCount}
            </text>
            <text y="-8" textAnchor="middle" fontSize="4.5" fill="#25312B">
              {g.merchantName.length > 18 ? `${g.merchantName.slice(0, 17)}…` : g.merchantName}
            </text>
            <title>{`${g.merchantName} · ${g.pickupLabel} · ~${g.distanceMeters} m · còn ${g.seatsLeft} chỗ`}</title>
          </g>
        );
      })}
    </svg>
  );
}

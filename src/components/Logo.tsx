/** An ink seal with a stacked three-note chord: one tune, harmonized. */
export function Logo({ size = 38 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden className="logo">
      <circle cx="32" cy="32" r="29" fill="#1f1b16" />
      <circle cx="32" cy="32" r="25.5" fill="none" stroke="#f2ead9" strokeOpacity=".35" strokeWidth="1" strokeDasharray="2 3" />
      {[24, 30, 36, 42].map((y) => (
        <line key={y} x1="13" x2="51" y1={y} y2={y} stroke="#f2ead9" strokeOpacity=".22" strokeWidth="1" />
      ))}
      <ellipse cx="27" cy="42" rx="5.2" ry="3.8" transform="rotate(-20 27 42)" fill="#f2ead9" />
      <ellipse cx="27" cy="36" rx="5.2" ry="3.8" transform="rotate(-20 27 36)" fill="#f2ead9" />
      <ellipse cx="27" cy="30" rx="5.2" ry="3.8" transform="rotate(-20 27 30)" fill="#e0573b" />
      <path d="M31.6 29 V12.5 c3 2.5 9 3.5 10 9" fill="none" stroke="#f2ead9" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

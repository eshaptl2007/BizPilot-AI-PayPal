// BizPilot AI logo: growth bars with a rising arrow, on a teal rounded square.
export default function Logo({ size = 36 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" role="img" aria-label="BizPilot AI logo">
      <defs>
        <linearGradient id="bp-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2dd4bf" />
          <stop offset="1" stopColor="#0f766e" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="11" fill="url(#bp-g)" />
      <rect x="9" y="24" width="5" height="8" rx="1.5" fill="#fff" opacity=".55" />
      <rect x="17.5" y="19" width="5" height="13" rx="1.5" fill="#fff" opacity=".75" />
      <rect x="26" y="14" width="5" height="18" rx="1.5" fill="#fff" />
      <path d="M8.5 19.5 L16 13 L21 16.5 L30 8" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M24.5 8 H30.5 V14" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

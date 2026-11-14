export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden="true">
      <path d="M3 17l6-7 5 5 5-8 6 9" fill="none" stroke="#2563eb" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 22l6-5 5 4 5-6 6 6" fill="none" stroke="#f59e0b" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" opacity=".9" />
    </svg>
  );
}

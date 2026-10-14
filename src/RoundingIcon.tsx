/** A shaded block with a rounded upper edge, matching the CAD rounding tool. */
export function RoundingIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M3 7 12 3 17 5 8 9Z" fill="#dce7ed" />
      <path d="M3 7 8 9Q11 10 11 13V22L3 18Z" fill="#bacbd5" />
      <path d="M11 13 20 9V18L11 22Z" fill="#8eaebe" />
      <path d="M8 9 17 5Q20 6 20 9L11 13Q11 10 8 9Z" fill="#7bc7e6" />
    </svg>
  );
}

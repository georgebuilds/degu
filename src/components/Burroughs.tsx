type BurroughsProps = {
  /** Visual variant. */
  state?: 'sorted' | 'idle'
  /** Outer pixel size. */
  size?: number
}

/**
 * Burroughs the degu — the brand mascot. Used sparingly: empty states,
 * onboarding, the "all sorted" reward screen.
 */
export function Burroughs({ state = 'sorted', size = 160 }: BurroughsProps) {
  const showCheck = state === 'sorted'
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 200 200"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Burroughs the degu"
    >
      <ellipse cx="100" cy="172" rx="62" ry="6" fill="rgba(0,0,0,0.35)" />
      <ellipse cx="100" cy="118" rx="58" ry="46" fill="#A38872" />
      <path
        d="M 46 118 Q 100 184 154 118 L 150 138 Q 100 184 50 138 Z"
        fill="#8FA67A"
      />
      <circle cx="100" cy="135" r="2" fill="#3a332c" />
      <circle cx="100" cy="148" r="2" fill="#3a332c" />
      <ellipse cx="100" cy="78" rx="42" ry="38" fill="#B89880" />
      <ellipse cx="70" cy="50" rx="11" ry="15" fill="#9C8068" />
      <ellipse cx="130" cy="50" rx="11" ry="15" fill="#9C8068" />
      <ellipse cx="70" cy="53" rx="5" ry="8" fill="#D4A89C" />
      <ellipse cx="130" cy="53" rx="5" ry="8" fill="#D4A89C" />
      <circle
        cx="84"
        cy="80"
        r="12"
        fill="rgba(239,231,215,0.18)"
        stroke="#2A2520"
        stroke-width="2.5"
      />
      <circle
        cx="116"
        cy="80"
        r="12"
        fill="rgba(239,231,215,0.18)"
        stroke="#2A2520"
        stroke-width="2.5"
      />
      <line
        x1="96"
        y1="80"
        x2="104"
        y2="80"
        stroke="#2A2520"
        stroke-width="2.5"
      />
      {showCheck ? (
        <>
          <path
            d="M 78 80 Q 84 76 90 80"
            fill="none"
            stroke="#2A2520"
            stroke-width="2"
            stroke-linecap="round"
          />
          <path
            d="M 110 80 Q 116 76 122 80"
            fill="none"
            stroke="#2A2520"
            stroke-width="2"
            stroke-linecap="round"
          />
        </>
      ) : (
        <>
          <circle cx="84" cy="80" r="3" fill="#2A2520" />
          <circle cx="116" cy="80" r="3" fill="#2A2520" />
        </>
      )}
      <ellipse cx="100" cy="95" rx="3" ry="2" fill="#2A2520" />
      <path
        d="M 94 102 Q 100 107 106 102"
        fill="none"
        stroke="#2A2520"
        stroke-width="2"
        stroke-linecap="round"
      />
      <line x1="76" y1="98" x2="58" y2="96" stroke="#6E6557" stroke-width="1" />
      <line
        x1="76"
        y1="101"
        x2="58"
        y2="103"
        stroke="#6E6557"
        stroke-width="1"
      />
      <line
        x1="124"
        y1="98"
        x2="142"
        y2="96"
        stroke="#6E6557"
        stroke-width="1"
      />
      <line
        x1="124"
        y1="101"
        x2="142"
        y2="103"
        stroke="#6E6557"
        stroke-width="1"
      />
      <ellipse cx="56" cy="128" rx="9" ry="7" fill="#A38872" />
      <ellipse cx="144" cy="128" rx="9" ry="7" fill="#A38872" />
      {showCheck ? (
        <>
          <circle cx="170" cy="60" r="14" fill="#8FA67A" />
          <path
            d="M 164 60 l 4 4 l 8 -8"
            fill="none"
            stroke="#1A1714"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </>
      ) : null}
    </svg>
  )
}

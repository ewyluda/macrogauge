"use client";

/** The site's one segmented-control style (.segmented / .segmented-option in
 *  globals.css): 32px tall on desktop, 44px touch targets on phones. */
export function SegmentedControl<K extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { key: K; label: string }[];
  value: K;
  onChange: (k: K) => void;
}) {
  return (
    <div className="segmented">
      {options.map((o) => {
        const active = o.key === value;
        return (
          <button
            key={o.key}
            type="button"
            className="segmented-option"
            aria-pressed={active}
            onClick={() => onChange(o.key)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

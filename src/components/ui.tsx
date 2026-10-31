import type { ReactNode } from 'react';

/**
 * Section header: a boxed rehearsal letter (as printed in a score), the title, and an
 * italic subtitle set like a performance marking.
 */
export function PanelHead({ mark, title, sub, right }: { mark: string; title: ReactNode; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div className="panel-head">
      <span className="mark" aria-hidden>
        {mark}
      </span>
      <h2>
        {title}
        {sub && <small>{sub}</small>}
      </h2>
      {right && <div className="right">{right}</div>}
    </div>
  );
}

export function Toggle({
  on,
  onChange,
  label,
  sub,
  disabled,
  testId,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  sub?: ReactNode;
  disabled?: boolean;
  testId?: string;
}) {
  return (
    <label
      className={`toggle ${on ? 'on' : ''}`}
      style={disabled ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
      data-testid={testId}
    >
      <input type="checkbox" hidden checked={on} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="sw" />
      <span>
        {label}
        {sub && <span className="sub">{sub}</span>}
      </span>
    </label>
  );
}

export function Seg<T extends string | number>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T;
  options: { value: T; label: ReactNode; disabled?: boolean; title?: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button
          key={String(o.value)}
          className={o.value === value ? 'on' : ''}
          disabled={disabled || o.disabled}
          title={o.title}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

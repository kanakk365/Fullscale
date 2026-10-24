// A number box that applies its value on Enter or when it loses focus, not on every key.
import { useEffect, useState } from 'react';

export function NumberInput({ value, onCommit, step, suffix }: { value: number; onCommit: (v: number) => void; step?: number; suffix?: string }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const done = () => {
    const v = Number(text);
    if (Number.isFinite(v) && v !== value) onCommit(v);
    else setText(String(value));
  };
  return (
    <span className="number-input">
      <input
        type="number"
        className="number"
        step={step}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={done}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
      {suffix && <span className="unit">{suffix}</span>}
    </span>
  );
}

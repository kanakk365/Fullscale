// A box for a length. People type it the way they write it ("3.5", "350 cm", "11' 6\"");
// it is read when they press Enter or leave the box, and refused with the reason if it
// can't be read. Empty can mean "follow the level" where `emptyMeans` says so.
import { formatLength, parseLength } from '@fullscale/core';
import { useEffect, useState } from 'react';

export function LengthInput(props: {
  value: number | undefined;
  onCommit: (metres: number | null) => void;
  /** shown greyed when empty, e.g. "2.70 (level)" */
  emptyMeans?: string;
  allowNegative?: boolean;
  title?: string;
}) {
  const shown = props.value === undefined ? '' : String(Math.round(props.value * 1000) / 1000);
  const [text, setText] = useState(shown);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setText(shown), [shown]);

  const done = () => {
    if (text.trim() === shown) return;
    if (text.trim() === '') {
      if (props.emptyMeans) props.onCommit(null);
      else setText(shown);
      return;
    }
    try {
      const metres = parseLength(text);
      if (!props.allowNegative && metres <= 0) throw new Error('Use a length above zero.');
      setError(null);
      props.onCommit(metres);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <span className="length-input">
      <input
        value={text}
        placeholder={props.emptyMeans}
        title={props.title ?? (props.value !== undefined ? formatLength(props.value, { unit: 'cm' }) : undefined)}
        onChange={(e) => {
          setText(e.target.value);
          setError(null);
        }}
        onBlur={done}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setText(shown);
            setError(null);
          }
        }}
      />
      <span className="unit">m</span>
      {error && <span className="field-error">{error}</span>}
    </span>
  );
}

// A colour swatch that opens the system colour picker. The colour is applied when the picker
// closes (the native "change" event), so dragging through shades doesn't make an edit each.
import { useEffect, useRef, useState } from 'react';

export function ColorInput({ value, onCommit, title }: { value: string; onCommit: (hex: string) => void; title?: string }) {
  const [shown, setShown] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => setShown(value), [value]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const done = () => {
      if (el.value.toLowerCase() !== value.toLowerCase()) onCommit(el.value);
    };
    el.addEventListener('change', done);
    return () => el.removeEventListener('change', done);
  }, [value, onCommit]);
  return <input ref={ref} type="color" className="color-input" title={title} value={shown} onChange={(e) => setShown(e.target.value)} />;
}

// Where a number came from, as a small badge: "scan ±2 cm", "you", "estimate"… so a guess
// never passes for a measurement.
import { formatUncertainty, type Source } from '@fullscale/core';

const LABELS: Readonly<Record<Source['kind'], string>> = {
  user: 'you',
  scan: 'scan',
  plan: 'plan',
  catalog: 'catalogue',
  maker: 'maker',
  estimate: 'estimate',
  agent: 'agent',
};

export function SourceBadge({ source, follows }: { source: Source | undefined; follows?: boolean }) {
  if (follows) return <span className="badge follows">level</span>;
  if (!source) return <span className="badge unknown">unknown</span>;
  const text = `${LABELS[source.kind]}${source.uncertainty !== undefined ? ` ${formatUncertainty(source.uncertainty)}` : ''}`;
  return (
    <span className={`badge ${source.kind}`} title={source.note ?? source.ref ?? ''}>
      {text}
    </span>
  );
}

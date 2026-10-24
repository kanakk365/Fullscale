// Problems in the home worth a look: the same checks agents get (validate_home), plus wall
// ends that meet nothing, with a button to close each gap.
import { openWallEnds, validateHome } from '@fullscale/core';
import { useMemo } from 'react';
import { commit, select } from '../app/actions.ts';
import { useEditor } from '../app/store.ts';

export function Issues() {
  const home = useEditor((s) => s.home);
  const level = useEditor((s) => s.level);
  const issues = useMemo(() => (home ? validateHome(home).filter((i) => i.severity !== 'info' || i.code !== 'item_outside_rooms') : []), [home]);
  const loose = useMemo(() => (home && level ? openWallEnds(home, level) : []), [home, level]);
  if (!home || (!issues.length && !loose.length)) return null;
  return (
    <section className="panel issues">
      <h2>To check ({issues.length + loose.length})</h2>
      <ul>
        {issues.map((i, n) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: two problems can share a code and ids; the list is rebuilt whole
          <li key={`${i.code}-${n}`} className={i.severity}>
            <button type="button" className="link" onClick={() => select(i.ids)}>
              {i.message}
            </button>
          </li>
        ))}
        {loose.map((end) => (
          <li key={`${end.wall}-${end.end}`} className="warning">
            <button type="button" className="link" onClick={() => select([end.wall])}>
              The {end.end} of wall {end.wall} meets nothing{end.candidate ? ` (${Math.round(end.candidate.gap * 100)} cm from ${end.candidate.wall})` : ''}.
            </button>
            {end.candidate && (
              <button type="button" onClick={() => void commit({ op: 'joinWallEnd', id: end.wall, end: end.end }, { label: `Close the gap at ${end.wall}` })}>
                Join
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

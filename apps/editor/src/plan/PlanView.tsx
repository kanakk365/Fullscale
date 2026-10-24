// The 2D plan: the home drawn from above in plan metres (the SVG's own units), with zoom and
// pan, the grid, selection outlines, and the active tool. Scroll pans and pinch (or Ctrl /
// Cmd + scroll) zooms, as in most design tools; dragging empty floor, the middle button or
// Space + drag also pan.
import { bounds, planGeometry, wallFootprint, type Vec2 } from '@fullscale/core';
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { redo, undo } from '../app/actions.ts';
import { getState, setState, shownHome, useEditor, type ToolKind } from '../app/store.ts';
import { Grid, Outlines, WallHandles } from './Overlays.tsx';
import { PlanShapes } from './PlanShapes.tsx';
import { useItemTool } from './tools/item.tsx';
import { useMeasureTool } from './tools/measure.tsx';
import { useOpeningTool } from './tools/opening.tsx';
import { useRoomTool } from './tools/room.tsx';
import { useSelectTool } from './tools/select.tsx';
import { useWallTool } from './tools/wall.tsx';
import type { PlanContext, PlanPointer, PlanTool } from './types.ts';

interface Camera {
  /** plan point at the centre of the view */
  cx: number;
  cz: number;
  /** pixels per metre */
  scale: number;
}

const SHORTCUTS: Readonly<Record<string, ToolKind>> = { v: 'select', w: 'wall', b: 'room', d: 'door', n: 'window', o: 'opening', f: 'item', m: 'measure' };
const MIN_SCALE = 4;
const MAX_SCALE = 2000;

export function PlanView() {
  const home = useEditor(shownHome);
  const base = useEditor((s) => s.home);
  const level = useEditor((s) => s.level);
  const selection = useEditor((s) => s.selection);
  const highlight = useEditor((s) => s.highlight);
  const others = useEditor((s) => s.othersSelection);
  const toolKind = useEditor((s) => s.tool);
  const snap = useEditor((s) => s.snap);
  const grid = useEditor((s) => s.grid);

  const wrap = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [measured, setSize] = useState<{ w: number; h: number } | null>(null);
  const size = measured ?? { w: 800, h: 600 };
  const [camera, setCamera] = useState<Camera | null>(null);
  const pan = useRef<{ x: number; y: number; camera: Camera } | null>(null);
  /** Once the person zooms or pans, the view stays where they put it. */
  const userMoved = useRef(false);
  const space = useRef(false);

  const plan = useMemo(() => (home && level ? planGeometry(home, { level }) : null), [home, level]);

  // Fit the level into view the first time it is shown.
  const fittedLevel = useRef<string | null>(null);
  // Refit for a new level, or a new view size the person hasn't zoomed away from; never
  // just because the home changed. The latest home is read through a ref for that reason.
  const latestHome = useRef(home);
  latestHome.current = home;
  const hasHome = home !== null;
  useEffect(() => {
    const h = latestHome.current;
    if (!hasHome || !h || !level || !measured) return;
    if (fittedLevel.current === level && userMoved.current) return;
    if (fittedLevel.current !== level) userMoved.current = false;
    fittedLevel.current = level;
    setCamera(fit(h, level, measured));
  }, [level, measured, hasHome]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const tools: Record<ToolKind, PlanTool> = {
    select: useSelectTool(),
    wall: useWallTool(),
    room: useRoomTool(),
    door: useOpeningTool('door'),
    window: useOpeningTool('window'),
    opening: useOpeningTool('opening'),
    item: useItemTool(),
    measure: useMeasureTool(),
  };
  const tool = tools[toolKind];
  const cam = camera ?? { cx: 0, cz: 0, scale: 50 };
  const view = { x: cam.cx - size.w / 2 / cam.scale, y: cam.cz - size.h / 2 / cam.scale, w: size.w / cam.scale, h: size.h / cam.scale };
  const ctx: PlanContext | null = home && base && level ? { home, base, level, scale: cam.scale, snap, grid } : null;

  // Scrolling: pan, or zoom about the pointer with Ctrl / Cmd (trackpad pinches arrive so).
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      userMoved.current = true;
      setCamera((c) => {
        if (!c) return c;
        if (!(e.ctrlKey || e.metaKey)) return { ...c, cx: c.cx + e.deltaX / c.scale, cz: c.cz + e.deltaY / c.scale };
        const rect = el.getBoundingClientRect();
        const factor = Math.exp(-e.deltaY * 0.01);
        const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, c.scale * factor));
        // Keep the point under the pointer where it is.
        const px = e.clientX - rect.left - rect.width / 2;
        const py = e.clientY - rect.top - rect.height / 2;
        return { scale, cx: c.cx + px / c.scale - px / scale, cz: c.cz + py / c.scale - py / scale };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // Keys: tool shortcuts, undo and redo, Space to pan; the rest goes to the tool.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;
      if (typing) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        void (e.shiftKey ? redo() : undo());
        return;
      }
      if (e.key === ' ') {
        space.current = true;
        e.preventDefault();
        return;
      }
      const state = getState();
      const c = currentContext();
      if (c && tools[state.tool].key?.(e, c)) {
        e.preventDefault();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape' && state.tool !== 'select') setState({ tool: 'select', preview: null });
      const shortcut = SHORTCUTS[e.key.toLowerCase()];
      if (shortcut && !e.shiftKey) setState({ tool: shortcut, preview: null });
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === ' ') space.current = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  });

  function currentContext(): PlanContext | null {
    const s = getState();
    const h = shownHome(s);
    return h && s.home && s.level ? { home: h, base: s.home, level: s.level, scale: cam.scale, snap: s.snap, grid: s.grid } : null;
  }

  function pointer(e: ReactPointerEvent): PlanPointer {
    const matrix = svg.current!.getScreenCTM()!.inverse();
    const at = new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix);
    const el = (e.target as Element).closest('[data-id], [data-dimension]');
    const rect = svg.current!.getBoundingClientRect();
    return {
      point: [at.x, at.y],
      target: {
        ...(el?.getAttribute('data-id') ? { id: el.getAttribute('data-id')! } : {}),
        ...(el?.getAttribute('data-kind') ? { kind: el.getAttribute('data-kind')! } : {}),
        ...(el?.getAttribute('data-handle') ? { handle: el.getAttribute('data-handle') as 'start' | 'end' } : {}),
        ...(el?.getAttribute('data-dimension') ? { dimension: el.getAttribute('data-dimension')! } : {}),
      },
      shift: e.shiftKey,
      alt: e.altKey,
      button: e.button,
      screen: [e.clientX - rect.left, e.clientY - rect.top],
    };
  }

  const onDown = (e: ReactPointerEvent) => {
    if (!ctx) return;
    svg.current!.setPointerCapture(e.pointerId);
    const p = pointer(e);
    const emptyFloor = !p.target.id && !p.target.dimension;
    if (e.button === 1 || space.current || (e.button === 0 && emptyFloor && tool.pansOnEmpty)) {
      pan.current = { x: e.clientX, y: e.clientY, camera: cam };
      if (e.button === 0 && emptyFloor) tool.down?.(p, ctx);
      return;
    }
    if (e.button === 0) tool.down?.(p, ctx);
  };

  const onMove = (e: ReactPointerEvent) => {
    if (!ctx) return;
    const p = pointer(e);
    setState({ cursor: p.point });
    if (pan.current) {
      const start = pan.current;
      setCamera({ ...start.camera, cx: start.camera.cx - (e.clientX - start.x) / start.camera.scale, cz: start.camera.cz - (e.clientY - start.y) / start.camera.scale });
      return;
    }
    tool.move?.(p, ctx);
  };

  const onUp = (e: ReactPointerEvent) => {
    if (!ctx) return;
    if (pan.current) {
      if (pan.current.x !== e.clientX || pan.current.y !== e.clientY) userMoved.current = true;
      pan.current = null;
      return;
    }
    if (e.button === 0) tool.up?.(pointer(e), ctx);
  };

  const zoom = (factor: number) => {
    userMoved.current = true;
    setCamera((c) => (c ? { ...c, scale: Math.min(MAX_SCALE, Math.max(MIN_SCALE, c.scale * factor)) } : c));
  };
  const singleWall = selection.length === 1 && home?.walls.some((w) => w.id === selection[0]) ? selection[0]! : null;

  return (
    <div className="plan" ref={wrap}>
      <svg
        ref={svg}
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        style={{ cursor: space.current || pan.current ? 'grab' : (tool.cursor ?? 'default') }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={() => setState({ cursor: null })}
        onContextMenu={(e) => e.preventDefault()}
      >
        <title>Floor plan</title>
        <Grid view={view} scale={cam.scale} />
        {plan && <PlanShapes plan={plan} scale={cam.scale} />}
        {home && others.map((o) => <Outlines key={o.actor} home={home} ids={o.ids} className="outline-others" />)}
        {home && highlight && <Outlines home={home} ids={highlight.ids} className="outline-agent" />}
        {home && <Outlines home={home} ids={selection} className="outline-selected" />}
        {home && singleWall && toolKind === 'select' && <WallHandles home={home} id={singleWall} scale={cam.scale} />}
        {ctx && tool.overlay?.(ctx)}
      </svg>
      <div className="plan-hud">{ctx && tool.hud?.(ctx)}</div>
      {highlight?.note && (
        <div className="agent-note">
          <strong>{highlight.actor}:</strong> {highlight.note}
          <button type="button" onClick={() => setState({ highlight: null })}>
            ×
          </button>
        </div>
      )}
      <div className="zoom">
        <button type="button" title="Zoom in" onClick={() => zoom(1.25)}>
          +
        </button>
        <button type="button" title="Zoom out" onClick={() => zoom(0.8)}>
          −
        </button>
        <button
          type="button"
          title="Fit the level"
          onClick={() => {
            userMoved.current = false;
            if (home && level) setCamera(fit(home, level, size));
          }}
        >
          ⤢
        </button>
      </div>
    </div>
  );
}

function fit(home: NonNullable<ReturnType<typeof shownHome>>, level: string, size: { w: number; h: number }): Camera {
  const points: Vec2[] = [...home.walls.filter((w) => w.level === level).flatMap((w) => wallFootprint(w)), ...home.rooms.filter((r) => r.level === level).flatMap((r) => r.polygon)];
  if (!points.length) return { cx: 2.5, cz: 2.5, scale: Math.min(size.w, size.h) / 8 };
  const b = bounds(points);
  const margin = 1.5;
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.min(size.w / (b.size[0] + 2 * margin), size.h / (b.size[1] + 2 * margin))));
  return { cx: b.min[0] + b.size[0] / 2, cz: b.min[1] + b.size[1] / 2, scale };
}

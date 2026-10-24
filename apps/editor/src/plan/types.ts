// What a plan tool gets from the plan view, and what it gives back.
import type { Home, SnapMode, Vec2 } from '@fullscale/core';
import type { ReactNode } from 'react';

/** Where the pointer is and what is under it. */
export interface PlanPointer {
  /** plan metres, as the pointer is (before any snapping) */
  point: Vec2;
  /** the element under the pointer */
  target: { id?: string; kind?: string; handle?: 'start' | 'end'; dimension?: string };
  shift: boolean;
  alt: boolean;
  /** primary button, for down/up */
  button: number;
  /** where the pointer is on screen, relative to the plan's top-left corner */
  screen: Vec2;
}

export interface PlanContext {
  /** the home as drawn (with any edit in progress) */
  home: Home;
  /** the studio's home, without the edit in progress */
  base: Home;
  level: string;
  /** pixels per metre at the current zoom */
  scale: number;
  snap: SnapMode;
  grid: number;
}

export interface PlanTool {
  down?(p: PlanPointer, ctx: PlanContext): void;
  move?(p: PlanPointer, ctx: PlanContext): void;
  up?(p: PlanPointer, ctx: PlanContext): void;
  /** true when the key was used */
  key?(e: KeyboardEvent, ctx: PlanContext): boolean;
  /** drawn over the plan, in plan metres */
  overlay?(ctx: PlanContext): ReactNode;
  /** drawn over the plan, in screen pixels (inputs and labels) */
  hud?(ctx: PlanContext): ReactNode;
  /** the pointer while this tool is active over the plan */
  cursor?: string;
  /** pans the plan when dragging empty floor */
  pansOnEmpty?: boolean;
}

/** Snap radii in screen pixels, turned into metres at the current zoom. */
export const SNAP_PX = { corner: 14, middle: 10, wall: 8 };

export const radiiAt = (scale: number) => ({ corner: SNAP_PX.corner / scale, middle: SNAP_PX.middle / scale, wall: SNAP_PX.wall / scale });

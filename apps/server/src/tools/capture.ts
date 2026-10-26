// Importing a phone scan.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { importScan, planExtraScan, type ExtraScan, type ScanInput } from '@fullscale/capture';
import { captureToHomeMatrix, formatLength, type Home } from '@fullscale/core';
import * as THREE from 'three';
import { z } from 'zod';
import { readCapture } from '../capture-files.ts';
import { insideFolder } from '../files.ts';
import { defineTool, Id, Point, receiptResult, write, WriteOptions, type ToolContext, type ToolResult } from './define.ts';

export const importCapture = defineTool({
  name: 'import_capture',
  title: 'Import a phone scan',
  description:
    'Turn a phone capture (a fullscale-capture/1 folder inside the home’s folder) into walls, doors, windows, rooms and furniture on a level, as one undo step. Every number is marked as scanned with its ±; wall thickness and door swing are marked as guesses. Tape checks in the capture are compared with the result; each comes with a fix (an edit for apply_edits) that sets the tape value — ask the person before applying. Another scan of a room already in the home (the phone’s “Scan more”, or a second scan; give room) adds no walls: it is lined up with the room, its photos join the others for view_photo and texture_from_photo, and how far its walls are from the model’s is reported. Then build the room’s detailed model from all its scans: room-builder build <first capture> --with <this capture>.',
  input: z.object({
    path: z.string().max(300).describe('the capture folder, relative to the home’s folder, e.g. "captures/20261024T101200Z-7KQ2"'),
    level: Id.optional(),
    at: Point.optional().describe('where the scan’s corner with the smallest x and z goes; default next to what is already there'),
    room: Id.optional().describe('this capture is another scan of this room: line it up with it instead of adding walls'),
    ...WriteOptions,
  }),
  effect: 'write',
  run(ctx, q) {
    const { input, problems } = readCapture(ctx.paths.homeDir, q.path);
    if (q.room || addsToImported(ctx.studio.home, input)) return extraScan(ctx, q, input, problems);
    const plan = importScan(ctx.studio.home, input, { ...(q.level ? { level: q.level } : {}), ...(q.at ? { at: q.at } : {}) });
    // Ids were worked out against this revision; refuse if the home moved on meanwhile.
    const receipt = write(ctx, plan.operation, { expect_rev: q.expect_rev ?? ctx.studio.rev, ...(q.dry_run ? { dry_run: true } : {}) });
    const c = plan.counts;
    receipt.notes.unshift(`Imported ${c.rooms} room(s), ${c.walls} walls, ${c.openings} doors and windows, ${c.items} items. The capture was turned ${plan.toHome.yaw}° to square it to the plan.`);
    for (const p of problems) receipt.notes.push(p);
    for (const i of plan.issues) receipt.notes.push(`${i.severity === 'warning' ? 'Warning' : 'Note'}: ${i.message}`);
    for (const check of plan.checks) {
      if (check.modelM === undefined) continue;
      receipt.notes.push(
        `Tape check ${check.id} (${check.kind.replace('_', ' ')}): scan ${formatLength(check.modelM)}, tape ${formatLength(check.tapeM)}, ${check.differenceM! >= 0 ? '+' : ''}${Math.round(check.differenceM! * 1000) / 10} cm (${check.band}).`,
      );
    }
    return receiptResult(receipt, { ids: plan.ids, toHome: plan.toHome, issues: plan.issues, checks: plan.checks, problems });
  },
});

/** Does the capture carry on from a scan already in the home, recognised by the phone? */
function addsToImported(home: Home, input: ScanInput): boolean {
  const addsTo = input.manifest?.rooms.find((r) => r.addsTo)?.addsTo;
  return !!addsTo && input.manifest?.alignment?.method === 'relocalized' && home.captures.some((c) => c.toHome && c.path.split('/').pop() === addsTo.capture);
}

function extraScan(ctx: ToolContext, q: { path: string; room?: string; expect_rev?: number; dry_run?: boolean }, input: ScanInput, problems: string[]): ToolResult {
  const home = ctx.studio.home;
  const plan = planExtraScan(home, input, q.room ? { room: q.room } : {});
  const receipt = write(ctx, plan.operation, { expect_rev: q.expect_rev ?? ctx.studio.rev, ...(q.dry_run ? { dry_run: true } : {}) });
  receipt.notes.unshift(...plan.notes);
  for (const p of problems) receipt.notes.push(p);
  const first = home.captures.find((c) => c.kind === 'phone-capture' && c.toHome && c.toHome.level === plan.toHome.level && c.path !== q.path);
  if (first?.toHome && !receipt.dry_run) {
    // How this scan's coordinates map onto the first scan's, for the room builder to put
    // their depth and photos together.
    const elevation = home.levels.find((l) => l.id === plan.toHome.level)?.elevation ?? 0;
    const toFirst = new THREE.Matrix4()
      .fromArray(captureToHomeMatrix(first.toHome, elevation))
      .invert()
      .multiply(new THREE.Matrix4().fromArray(captureToHomeMatrix(plan.toHome, elevation)));
    const built = insideFolder(ctx.paths.homeDir, `${q.path}/built`);
    if (built) {
      mkdirSync(built, { recursive: true });
      writeFileSync(
        join(built, 'aligned.json'),
        `${JSON.stringify({ format: 'fullscale-alignment/1', to: first.path.split('/').pop(), method: plan.method, fit: plan.fit, matrix: toFirst.toArray().map((v) => Math.round(v * 1e9) / 1e9) }, null, 2)}\n`,
      );
      if (plan.fit.worst <= 0.05 && plan.fit.length <= 0.05) receipt.notes.push(`For the detailed model from all scans: room-builder build ${first.path} --with ${q.path}`);
    }
  }
  const result: ToolResult = receiptResult(receipt, { room: plan.room, method: plan.method, toHome: plan.toHome, fit: plan.fit, newObjects: plan.newObjects, problems } satisfies Partial<ExtraScan> &
    Record<string, unknown>);
  return result;
}

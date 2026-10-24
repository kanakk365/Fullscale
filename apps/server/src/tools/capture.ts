// Importing a phone scan.
import { importScan } from '@fullscale/capture';
import { formatLength } from '@fullscale/core';
import { z } from 'zod';
import { readCapture } from '../capture-files.ts';
import { defineTool, Id, Point, receiptResult, write, WriteOptions } from './define.ts';

export const importCapture = defineTool({
  name: 'import_capture',
  title: 'Import a phone scan',
  description:
    'Turn a phone capture (a fullscale-capture/1 folder inside the home’s folder) into walls, doors, windows, rooms and furniture on a level, as one undo step. Every number is marked as scanned with its ±; wall thickness and door swing are marked as guesses. Tape checks in the capture are compared with the result; each comes with a fix (an edit for apply_edits) that sets the tape value — ask the person before applying.',
  input: z.object({
    path: z.string().max(300).describe('the capture folder, relative to the home’s folder, e.g. "captures/20261024T101200Z-7KQ2"'),
    level: Id.optional(),
    at: Point.optional().describe('where the scan’s corner with the smallest x and z goes; default next to what is already there'),
    ...WriteOptions,
  }),
  effect: 'write',
  run(ctx, q) {
    const { input, problems } = readCapture(ctx.paths.homeDir, q.path);
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

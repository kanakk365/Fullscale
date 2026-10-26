// The agent tools, served over MCP. The SDK builds a fresh MCP server for each request;
// every one of them works on the same studio, so agents, the editor and Blender always
// share one home.
import { isEditError } from '@fullscale/core';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { TOOLS, type Tool, type ToolContext } from './tools/index.ts';
import { NAME, VERSION } from './version.ts';

/** What every agent is told on connecting. Kept short: clients add it to every session. */
export const INSTRUCTIONS = `Fullscale holds one home (or any space) at real size, shared live with a person in the editor and with Blender.
- Units are metres. Plan points are [x, z]: x to the right, z down the plan. 3D points are [x, y, z] with y up. Turns are degrees counter-clockwise seen from above.
- Lengths you send may be text with units ("350 cm", "11' 6\\"").
- Start with get_home, then get_level. Look with view_plan before and after editing.
- Every number says where it came from (scan, user, plan, maker, catalog, estimate, agent) and how sure it is. Never invent a measurement: ask the person, or say a value is an estimate (set_source).
- When a scan or photo leaves you unsure (a curtain or a painted wall? which colour? what is this object? built in or furniture?), ask the person before building on a guess: a few short questions at a time, with the choices you see, pointing at the place with highlight. Mark what you still had to guess as an estimate.
- view_photo shows the scans' photos; texture_from_photo puts their real pictures (prints, framed photos, screens) on the model.
- Renders are lit by the home's own lights (the catalogue's lighting items) and daylight for the time asked. Scans don't find lights: add the room's real ones from its photos, and ask whether they are warm or white when you can't tell.
- Writes answer with what really changed ("achieved") and the new revision. Pass expect_rev to refuse if someone changed the home meanwhile.
- A refusal has a code and says what would work. Nothing changes when a call is refused.
- check_fit answers say what was and was not checked; don't claim more.
- The person may edit at the same time: recent_changes and get_selection show what they did and selected; highlight points things out to them.
- Redesign in a design (new_design), never the real home; compare_designs shows ideas side by side.
- Undo only undoes your own edits.
- The user's own 3D models (list_models) never leave this computer.`;

/** An MCP request handler for the studio's tools. */
export function mcpHandler(ctx: ToolContext) {
  return createMcpHandler(() => {
    const server = new McpServer({ name: NAME, version: VERSION }, { instructions: INSTRUCTIONS });
    for (const tool of TOOLS) register(server, tool, ctx);
    return server;
  });
}

function register(server: McpServer, tool: Tool, ctx: ToolContext): void {
  server.registerTool(
    tool.name,
    {
      title: tool.title,
      description: tool.description,
      inputSchema: tool.input,
      annotations: {
        readOnlyHint: tool.effect === 'read',
        destructiveHint: tool.effect === 'destructive',
        idempotentHint: tool.effect === 'read',
        openWorldHint: false,
      },
    },
    async (input: unknown) => {
      try {
        const result = await tool.run(ctx, input as never);
        return {
          content: [{ type: 'text' as const, text: result.text }, ...(result.images ?? []).map((png) => ({ type: 'image' as const, data: png.toString('base64'), mimeType: 'image/png' }))],
          structuredContent: result.data,
        };
      } catch (err) {
        // A refusal is part of the conversation: the agent reads the code and the fix.
        if (isEditError(err)) return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(err.toJSON()) }] };
        console.error(`Tool ${tool.name} failed:`, err);
        const message = { error: `Something went wrong inside the studio (${(err as Error).message}). The home was not changed.`, code: 'internal_error' };
        return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(message) }] };
      }
    },
  );
}

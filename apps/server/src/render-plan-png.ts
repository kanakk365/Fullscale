// Rasterise the SVG plan to PNG without a GPU.
import { Resvg } from '@resvg/resvg-js';
import { renderPlanSvg, type Home, type PlanSvgOptions } from '@fullscale/core';

export function renderPlanPng(home: Home, opts: PlanSvgOptions = {}): { png: Buffer; width: number; height: number; metresPerPixel: number } {
  const { svg, width, height, metresPerPixel } = renderPlanSvg(home, opts);
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: width }, font: { loadSystemFonts: true } });
  return { png: Buffer.from(resvg.render().asPng()), width, height, metresPerPixel };
}

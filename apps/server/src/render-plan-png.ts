// Rasterise the SVG plan to PNG without a GPU.
import { Resvg } from '@resvg/resvg-js';
import { renderPlanSvg, type PlanSvg, type PlanSvgOptions, type Home } from '@fullscale/core';

export function renderPlanPng(home: Home, opts: PlanSvgOptions = {}): Omit<PlanSvg, 'svg'> & { png: Buffer } {
  const { svg, ...info } = renderPlanSvg(home, opts);
  return { ...info, png: svgToPng(svg, info.width) };
}

/** Rasterise any SVG at a pixel width. */
export function svgToPng(svg: string, width: number): Buffer {
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: width }, font: { loadSystemFonts: true } });
  return Buffer.from(resvg.render().asPng());
}

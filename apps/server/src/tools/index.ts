// Every agent tool, in the order clients list them: looking first, then building,
// furnishing, and managing.
import { addOpening, addRoom, detectRooms, drawWalls, joinWallEnd, mergeWalls, moveWall, splitWall, updateOpening, updateWall } from './build.ts';
import { importCapture } from './capture.ts';
import type { Tool } from './define.ts';
import { addItems, listModelsTool, paint, updateItem, upsertMaterial } from './furnish.ts';
import { textureFromPhoto, viewPhoto } from './photos.ts';
import { addPlanPicture, applyEdits, clearHome, redo, remove, scalePlanPicture, setSource, undo } from './manage.ts';
import { checkFitTool, findElements, fitsThroughTool, getElements, getHome, getLevel, getSelection, measure, recentChanges, searchCatalog, validate } from './read.ts';
import { highlight, renderPhoto, view3d, viewPlan, viewPlanPicture } from './views.ts';

// Each tool's run function takes its own input type; the list only needs what they share.
export const TOOLS: readonly Tool[] = [
  getHome,
  getLevel,
  getElements,
  findElements,
  getSelection,
  recentChanges,
  viewPlan,
  view3d,
  renderPhoto,
  measure,
  checkFitTool,
  fitsThroughTool,
  validate,
  searchCatalog,
  listModelsTool,
  drawWalls,
  addRoom,
  updateWall,
  moveWall,
  splitWall,
  mergeWalls,
  joinWallEnd,
  detectRooms,
  addOpening,
  updateOpening,
  addItems,
  updateItem,
  paint,
  upsertMaterial,
  setSource,
  remove,
  applyEdits,
  undo,
  redo,
  clearHome,
  highlight,
  addPlanPicture,
  scalePlanPicture,
  viewPlanPicture,
  importCapture,
  viewPhoto,
  textureFromPhoto,
] as unknown as readonly Tool[];

export type { Tool, ToolContext, ToolResult } from './define.ts';

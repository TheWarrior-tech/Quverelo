/** Shared headless paper.js scope (used for booleans and SVG import). */
import paperCore from 'paper/dist/paper-core';

let ready = false;

export function getPaper(): typeof paperCore {
  if (!ready) {
    paperCore.setup(new paperCore.Size(1, 1));
    ready = true;
  }
  return paperCore;
}

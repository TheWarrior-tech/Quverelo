/** Selection chrome shared by the viewport and fabric proxies. */
import type { FabricObject } from 'fabric';

/** Canvas overlay colour for object selection (DESIGN.md §3). */
export const SELECTION_COLOR = '#2fb8a6';
/** Ring around the accent handles so they read on any artwork. */
export const HANDLE_RING = '#ffffff';
/** Handle edge in CSS px, constant at every zoom. */
export const HANDLE_SIZE = 7;
const ROTATE_OFFSET = 20;

/** Size handles and the rotation offset for any selectable fabric object. */
export function tuneControls(o: FabricObject): void {
  o.padding = 0;
  // hit area; the drawn handle is HANDLE_SIZE (see Viewport.drawSelectionChrome)
  o.cornerSize = HANDLE_SIZE + 4;
  o.touchCornerSize = 16;
  o.borderColor = SELECTION_COLOR;
  o.cornerColor = SELECTION_COLOR;
  o.cornerStrokeColor = HANDLE_RING;
  o.cornerStyle = 'rect';
  o.transparentCorners = false;
  const mtr = o.controls?.mtr;
  if (mtr) {
    mtr.offsetY = -ROTATE_OFFSET;
    mtr.withConnection = true;
  }
}

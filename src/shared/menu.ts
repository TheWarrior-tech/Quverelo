import type { FeatureId } from '../core/policy';

export interface MenuCommand {
  id: string;
  label: string;
  /** Electron accelerator syntax */
  accel?: string;
  feature?: FeatureId;
  /**
   * Synonyms the command palette also matches (plain words people search for:
   * "cutout" for Select Subject, US spellings, verbs from other apps).
   */
  keywords?: string[];
}

export interface MenuSection {
  label: string;
  items: (MenuCommand | '-')[];
}

export const APP_MENU: MenuSection[] = [
  {
    label: 'File',
    items: [
      { id: 'file.new', label: 'New…', accel: 'CmdOrCtrl+N', keywords: ['create', 'blank', 'document', 'start'] },
      { id: 'file.open', label: 'Open…', accel: 'CmdOrCtrl+O', keywords: ['load', 'browse', 'file', 'recent'] },
      { id: 'file.close', label: 'Close Document', accel: 'CmdOrCtrl+W', keywords: ['quit document', 'exit'] },
      '-',
      { id: 'file.save', label: 'Save', accel: 'CmdOrCtrl+S', keywords: ['store', 'keep', 'write'] },
      { id: 'file.save-as', label: 'Save As…', accel: 'CmdOrCtrl+Shift+S', keywords: ['copy', 'rename', 'duplicate file'] },
      '-',
      { id: 'file.place', label: 'Place Image…', accel: 'CmdOrCtrl+Shift+P', feature: 'import-images', keywords: ['import', 'insert', 'picture', 'photo', 'add image', 'jpg', 'png'] },
      { id: 'file.import-svg', label: 'Import SVG…', feature: 'import-svg', keywords: ['vector', 'insert', 'illustrator'] },
      '-',
      { id: 'file.export', label: 'Export…', accel: 'CmdOrCtrl+Shift+E', keywords: ['download', 'share', 'output', 'save a copy'] },
      { id: 'file.export-again', label: 'Export Again', accel: 'CmdOrCtrl+Alt+Shift+E', keywords: ['repeat export', 're-export', 'same settings'] },
      { id: 'file.export-png', label: 'Export PNG…', feature: 'export-png', keywords: ['image', 'picture', 'download', 'save as png', 'transparent'] },
      { id: 'file.export-jpg', label: 'Export JPEG…', feature: 'export-jpg', keywords: ['jpg', 'image', 'picture', 'photo', 'download'] },
      { id: 'file.export-svg', label: 'Export SVG…', feature: 'export-svg', keywords: ['vector', 'web', 'download'] },
      { id: 'file.export-pdf', label: 'Export PDF…', accel: 'CmdOrCtrl+Alt+P', feature: 'export-pdf', keywords: ['pdf', 'print', 'printing', 'hand in', 'document'] },
      '-',
      { id: 'file.assignment', label: 'Assignment Details…', feature: 'assignments', keywords: ['homework', 'task', 'teacher', 'brief'] },
      { id: 'file.hand-in', label: 'Hand In…', feature: 'assignments', keywords: ['submit', 'turn in', 'homework', 'send to teacher'] },
      '-',
      { id: 'file.document-setup', label: 'Document Setup…', accel: 'CmdOrCtrl+Alt+D', keywords: ['page size', 'margins', 'bleed', 'columns', 'document settings'] },
      { id: 'app.preferences', label: 'Preferences…', accel: 'CmdOrCtrl+,', keywords: ['settings', 'options', 'config', 'theme', 'appearance'] },
    ],
  },
  {
    label: 'Edit',
    items: [
      { id: 'edit.undo', label: 'Undo', accel: 'CmdOrCtrl+Z', keywords: ['back', 'revert', 'mistake'] },
      { id: 'edit.redo', label: 'Redo', accel: 'CmdOrCtrl+Shift+Z', keywords: ['again', 'forward'] },
      '-',
      { id: 'edit.cut', label: 'Cut', accel: 'CmdOrCtrl+X' },
      { id: 'edit.copy', label: 'Copy', accel: 'CmdOrCtrl+C' },
      { id: 'edit.paste', label: 'Paste', accel: 'CmdOrCtrl+V' },
      { id: 'edit.duplicate', label: 'Duplicate', accel: 'CmdOrCtrl+J', keywords: ['copy', 'clone'] },
      { id: 'edit.delete', label: 'Delete', keywords: ['remove', 'erase', 'trash', 'bin'] },
      '-',
      { id: 'edit.select-all', label: 'Select All', accel: 'CmdOrCtrl+A', keywords: ['everything'] },
      { id: 'edit.deselect', label: 'Deselect', accel: 'CmdOrCtrl+D', keywords: ['clear selection', 'unselect', 'none'] },
    ],
  },
  {
    label: 'Arrange',
    items: [
      { id: 'arrange.front', label: 'Bring to Front', accel: 'CmdOrCtrl+Shift+]', keywords: ['top', 'raise', 'order', 'z-order'] },
      { id: 'arrange.forward', label: 'Bring Forward', accel: 'CmdOrCtrl+]', keywords: ['raise', 'up', 'order'] },
      { id: 'arrange.backward', label: 'Send Backward', accel: 'CmdOrCtrl+[', keywords: ['lower', 'down', 'order'] },
      { id: 'arrange.back', label: 'Send to Back', accel: 'CmdOrCtrl+Shift+[', keywords: ['bottom', 'lower', 'order', 'z-order'] },
      '-',
      { id: 'arrange.group', label: 'Group', accel: 'CmdOrCtrl+G', keywords: ['combine', 'join'] },
      { id: 'arrange.ungroup', label: 'Ungroup', accel: 'CmdOrCtrl+Shift+G', keywords: ['split', 'separate', 'break apart'] },
      '-',
      { id: 'arrange.align-left', label: 'Align Left' },
      { id: 'arrange.align-hcenter', label: 'Align Centre', keywords: ['center', 'centre horizontally', 'middle'] },
      { id: 'arrange.align-right', label: 'Align Right' },
      { id: 'arrange.align-top', label: 'Align Top' },
      { id: 'arrange.align-vcenter', label: 'Align Middle', keywords: ['center', 'centre vertically'] },
      { id: 'arrange.align-bottom', label: 'Align Bottom' },
      { id: 'arrange.distribute-h', label: 'Distribute Horizontally', keywords: ['space evenly', 'spacing'] },
      { id: 'arrange.distribute-v', label: 'Distribute Vertically', keywords: ['space evenly', 'spacing'] },
      '-',
      { id: 'arrange.flip-h', label: 'Flip Horizontal', keywords: ['mirror', 'reflect'] },
      { id: 'arrange.flip-v', label: 'Flip Vertical', keywords: ['mirror', 'reflect', 'upside down'] },
      { id: 'arrange.rotate-cw', label: 'Rotate 90° Clockwise', keywords: ['turn', 'right'] },
      { id: 'arrange.rotate-ccw', label: 'Rotate 90° Anticlockwise', keywords: ['turn', 'left', 'counterclockwise', 'counter-clockwise'] },
    ],
  },
  {
    label: 'Layer',
    items: [
      { id: 'layer.new-pixel', label: 'New Pixel Layer', accel: 'CmdOrCtrl+Shift+N', keywords: ['add layer', 'paint layer', 'raster layer'] },
      { id: 'layer.rasterize', label: 'Rasterise', keywords: ['rasterize', 'flatten', 'pixels', 'convert to pixels'] },
      { id: 'layer.merge-down', label: 'Merge Down', accel: 'CmdOrCtrl+E', keywords: ['flatten', 'combine layers', 'merge'] },
      '-',
      { id: 'layer.mask-selection', label: 'Mask to Selection', keywords: ['hide', 'layer mask', 'mask'] },
      { id: 'layer.mask-shape', label: 'Mask with Shape Above', keywords: ['clip', 'clipping mask', 'crop to shape'] },
      { id: 'layer.release-mask', label: 'Release Mask', keywords: ['unmask', 'remove mask'] },
      '-',
      { id: 'layer.convert-curves', label: 'Convert to Curves', accel: 'CmdOrCtrl+Enter', keywords: ['outline', 'expand', 'path', 'vectorise', 'vectorize'] },
      { id: 'layer.bool-add', label: 'Boolean: Add', keywords: ['union', 'merge shapes', 'combine', 'pathfinder'] },
      { id: 'layer.bool-subtract', label: 'Boolean: Subtract', keywords: ['minus', 'cut', 'punch', 'pathfinder'] },
      { id: 'layer.bool-intersect', label: 'Boolean: Intersect', keywords: ['overlap', 'pathfinder'] },
      { id: 'layer.bool-exclude', label: 'Boolean: Exclude', keywords: ['xor', 'difference', 'pathfinder'] },
      { id: 'layer.bool-divide', label: 'Boolean: Divide', keywords: ['split', 'fragment', 'pathfinder'] },
      '-',
      { id: 'layer.lock', label: 'Lock / Unlock', accel: 'CmdOrCtrl+L', keywords: ['freeze', 'protect'] },
      { id: 'layer.hide', label: 'Show / Hide', accel: 'CmdOrCtrl+Shift+H', keywords: ['visibility', 'show', 'eye', 'toggle visibility'] },
    ],
  },
  {
    label: 'Select',
    items: [
      { id: 'select.all-pixels', label: 'Select All (Pixels)', keywords: ['everything', 'marquee'] },
      { id: 'select.none', label: 'Deselect Pixels', accel: 'CmdOrCtrl+Shift+D', keywords: ['clear', 'unselect'] },
      { id: 'select.invert', label: 'Invert Pixel Selection', accel: 'CmdOrCtrl+Shift+I', keywords: ['inverse', 'reverse', 'opposite'] },
      { id: 'select.subject', label: 'Select Subject', accel: 'CmdOrCtrl+Alt+S', keywords: ['cutout', 'cut out', 'remove background', 'background remover', 'auto select', 'ai', 'person', 'object', 'magic'] },
      { id: 'select.remove-background', label: 'Remove Background', keywords: ['cutout', 'cut out', 'background remover', 'transparent', 'mask', 'isolate'] },
      { id: 'select.cutout', label: 'Cut Out Subject (Soft Edges)', keywords: ['cutout', 'cut out', 'remove background', 'hair', 'fur', 'matte', 'matting', 'soft edges', 'transparent', 'png'] },
      '-',
      { id: 'select.crop', label: 'Crop to Selection', keywords: ['trim', 'cut', 'crop'] },
      { id: 'select.fill', label: 'Fill Selection', keywords: ['paint', 'colour', 'color', 'bucket'] },
      { id: 'select.clear', label: 'Clear Selection Pixels', keywords: ['delete', 'erase', 'remove pixels'] },
      { id: 'select.copy-to-layer', label: 'Copy Selection to New Layer', keywords: ['extract', 'duplicate', 'new layer'] },
    ],
  },
  {
    label: 'Document',
    items: [
      { id: 'page.add', label: 'Add Page', keywords: ['new page', 'insert page'] },
      { id: 'page.duplicate', label: 'Duplicate Page', keywords: ['copy page'] },
      { id: 'page.delete', label: 'Delete Page', keywords: ['remove page'] },
      { id: 'page.prev', label: 'Previous Page', keywords: ['back', 'previous'] },
      { id: 'page.next', label: 'Next Page', keywords: ['forward'] },
      '-',
      { id: 'master.add', label: 'Add Master Page', keywords: ['template page', 'header', 'footer', 'parent page'] },
      { id: 'text.link', label: 'Link Text Frames', keywords: ['thread', 'flow', 'overflow', 'columns'] },
      { id: 'text.unlink', label: 'Unlink Text Frame', keywords: ['unthread', 'break flow'] },
      '-',
      { id: 'doc.resize', label: 'Resize Document…', keywords: ['scale', 'image size', 'canvas size', 'dimensions'] },
      { id: 'doc.clear-guides', label: 'Clear Guides', keywords: ['remove guides', 'delete guides'] },
    ],
  },
  {
    label: 'View',
    items: [
      { id: 'view.zoom-in', label: 'Zoom In', accel: 'CmdOrCtrl+=', keywords: ['magnify', 'bigger', 'enlarge'] },
      { id: 'view.zoom-out', label: 'Zoom Out', accel: 'CmdOrCtrl+-', keywords: ['smaller', 'shrink'] },
      { id: 'view.zoom-fit', label: 'Zoom to Fit', accel: 'CmdOrCtrl+0', keywords: ['fit', 'whole page', 'fit to screen', 'fit to window'] },
      { id: 'view.zoom-100', label: 'Actual Size', accel: 'CmdOrCtrl+1', keywords: ['100%', 'actual pixels', 'real size'] },
      '-',
      { id: 'view.rulers', label: 'Toggle Rulers', accel: 'CmdOrCtrl+R', keywords: ['guides', 'measure'] },
      { id: 'view.snapping', label: 'Toggle Snapping', accel: 'CmdOrCtrl+;', keywords: ['snap', 'magnet', 'align to grid'] },
      '-',
      { id: 'studio.photo', label: 'Photo Studio', accel: 'CmdOrCtrl+Alt+1', feature: 'photo', keywords: ['pixels', 'raster', 'photo editing', 'retouch'] },
      { id: 'studio.vector', label: 'Vector Studio', accel: 'CmdOrCtrl+Alt+2', feature: 'vector', keywords: ['illustration', 'drawing', 'shapes', 'logo'] },
      { id: 'studio.layout', label: 'Layout Studio', accel: 'CmdOrCtrl+Alt+3', feature: 'layout', keywords: ['pages', 'publishing', 'worksheet', 'newsletter', 'dtp'] },
      '-',
      { id: 'view.theme-dark', label: 'Dark Theme', keywords: ['night', 'appearance', 'mode'] },
      { id: 'view.theme-light', label: 'Light Theme', keywords: ['day', 'appearance', 'mode', 'white'] },
      { id: 'view.theme-contrast', label: 'High Contrast Theme', keywords: ['accessibility', 'a11y', 'high contrast', 'appearance'] },
      { id: 'view.ui-bigger', label: 'Larger Interface', accel: 'CmdOrCtrl+Alt+=', keywords: ['zoom interface', 'scale', 'larger text', 'accessibility'] },
      { id: 'view.ui-smaller', label: 'Smaller Interface', accel: 'CmdOrCtrl+Alt+-', keywords: ['scale', 'smaller text', 'compact'] },
      { id: 'view.ui-reset', label: 'Reset Interface Size', keywords: ['scale', 'default size'] },
      { id: 'view.devtools', label: 'Developer Tools', accel: 'CmdOrCtrl+Alt+I' },
    ],
  },
  {
    label: 'Help',
    items: [
      { id: 'help.command-palette', label: 'Command Palette…', accel: 'CmdOrCtrl+K', keywords: ['search', 'find', 'run', 'actions', 'commands', 'go to'] },
      { id: 'help.shortcuts', label: 'Keyboard Shortcuts', accel: 'F1', keywords: ['keys', 'hotkeys', 'keyboard', 'cheat sheet'] },
      { id: 'help.guide', label: 'Quick Start Guide', keywords: ['tutorial', 'help', 'manual', 'how to', 'docs'] },
      { id: 'help.check-updates', label: 'Check for Updates…', feature: 'update-check', keywords: ['update', 'upgrade', 'new version'] },
      { id: 'help.about', label: 'About Quvrelo', keywords: ['version', 'licence', 'license', 'credits'] },
    ],
  },
];

export function allMenuCommands(): MenuCommand[] {
  return APP_MENU.flatMap((s) => s.items.filter((i): i is MenuCommand => i !== '-'));
}

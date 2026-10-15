import type { FeatureId } from '../core/policy';

export interface MenuCommand {
  id: string;
  label: string;
  /** Electron accelerator syntax */
  accel?: string;
  feature?: FeatureId;
}

export interface MenuSection {
  label: string;
  items: (MenuCommand | '-')[];
}

export const APP_MENU: MenuSection[] = [
  {
    label: 'File',
    items: [
      { id: 'file.new', label: 'New…', accel: 'CmdOrCtrl+N' },
      { id: 'file.open', label: 'Open…', accel: 'CmdOrCtrl+O' },
      { id: 'file.close', label: 'Close Document', accel: 'CmdOrCtrl+W' },
      '-',
      { id: 'file.save', label: 'Save', accel: 'CmdOrCtrl+S' },
      { id: 'file.save-as', label: 'Save As…', accel: 'CmdOrCtrl+Shift+S' },
      '-',
      { id: 'file.place', label: 'Place Image…', accel: 'CmdOrCtrl+Shift+P', feature: 'import-images' },
      { id: 'file.import-svg', label: 'Import SVG…', feature: 'import-svg' },
      '-',
      { id: 'file.export-png', label: 'Export PNG…', accel: 'CmdOrCtrl+Shift+E', feature: 'export-png' },
      { id: 'file.export-jpg', label: 'Export JPEG…', feature: 'export-jpg' },
      { id: 'file.export-svg', label: 'Export SVG…', feature: 'export-svg' },
      { id: 'file.export-pdf', label: 'Export PDF…', accel: 'CmdOrCtrl+Alt+P', feature: 'export-pdf' },
      '-',
      { id: 'file.assignment', label: 'Assignment Details…', feature: 'assignments' },
      { id: 'file.hand-in', label: 'Hand In…', feature: 'assignments' },
      '-',
      { id: 'file.document-setup', label: 'Document Setup…', accel: 'CmdOrCtrl+Alt+D' },
      { id: 'app.preferences', label: 'Preferences…', accel: 'CmdOrCtrl+,' },
    ],
  },
  {
    label: 'Edit',
    items: [
      { id: 'edit.undo', label: 'Undo', accel: 'CmdOrCtrl+Z' },
      { id: 'edit.redo', label: 'Redo', accel: 'CmdOrCtrl+Shift+Z' },
      '-',
      { id: 'edit.cut', label: 'Cut', accel: 'CmdOrCtrl+X' },
      { id: 'edit.copy', label: 'Copy', accel: 'CmdOrCtrl+C' },
      { id: 'edit.paste', label: 'Paste', accel: 'CmdOrCtrl+V' },
      { id: 'edit.duplicate', label: 'Duplicate', accel: 'CmdOrCtrl+J' },
      { id: 'edit.delete', label: 'Delete' },
      '-',
      { id: 'edit.select-all', label: 'Select All', accel: 'CmdOrCtrl+A' },
      { id: 'edit.deselect', label: 'Deselect', accel: 'CmdOrCtrl+D' },
    ],
  },
  {
    label: 'Arrange',
    items: [
      { id: 'arrange.front', label: 'Bring to Front', accel: 'CmdOrCtrl+Shift+]' },
      { id: 'arrange.forward', label: 'Bring Forward', accel: 'CmdOrCtrl+]' },
      { id: 'arrange.backward', label: 'Send Backward', accel: 'CmdOrCtrl+[' },
      { id: 'arrange.back', label: 'Send to Back', accel: 'CmdOrCtrl+Shift+[' },
      '-',
      { id: 'arrange.group', label: 'Group', accel: 'CmdOrCtrl+G' },
      { id: 'arrange.ungroup', label: 'Ungroup', accel: 'CmdOrCtrl+Shift+G' },
      '-',
      { id: 'arrange.align-left', label: 'Align Left' },
      { id: 'arrange.align-hcenter', label: 'Align Centre' },
      { id: 'arrange.align-right', label: 'Align Right' },
      { id: 'arrange.align-top', label: 'Align Top' },
      { id: 'arrange.align-vcenter', label: 'Align Middle' },
      { id: 'arrange.align-bottom', label: 'Align Bottom' },
      { id: 'arrange.distribute-h', label: 'Distribute Horizontally' },
      { id: 'arrange.distribute-v', label: 'Distribute Vertically' },
      '-',
      { id: 'arrange.flip-h', label: 'Flip Horizontal' },
      { id: 'arrange.flip-v', label: 'Flip Vertical' },
      { id: 'arrange.rotate-cw', label: 'Rotate 90° Clockwise' },
      { id: 'arrange.rotate-ccw', label: 'Rotate 90° Anticlockwise' },
    ],
  },
  {
    label: 'Layer',
    items: [
      { id: 'layer.new-pixel', label: 'New Pixel Layer', accel: 'CmdOrCtrl+Shift+N' },
      { id: 'layer.rasterize', label: 'Rasterise' },
      { id: 'layer.merge-down', label: 'Merge Down', accel: 'CmdOrCtrl+E' },
      '-',
      { id: 'layer.mask-selection', label: 'Mask to Selection' },
      { id: 'layer.mask-shape', label: 'Mask with Shape Above' },
      { id: 'layer.release-mask', label: 'Release Mask' },
      '-',
      { id: 'layer.convert-curves', label: 'Convert to Curves', accel: 'CmdOrCtrl+Enter' },
      { id: 'layer.bool-add', label: 'Boolean: Add' },
      { id: 'layer.bool-subtract', label: 'Boolean: Subtract' },
      { id: 'layer.bool-intersect', label: 'Boolean: Intersect' },
      { id: 'layer.bool-exclude', label: 'Boolean: Exclude' },
      { id: 'layer.bool-divide', label: 'Boolean: Divide' },
      '-',
      { id: 'layer.lock', label: 'Lock / Unlock', accel: 'CmdOrCtrl+L' },
      { id: 'layer.hide', label: 'Show / Hide', accel: 'CmdOrCtrl+Shift+H' },
    ],
  },
  {
    label: 'Select',
    items: [
      { id: 'select.all-pixels', label: 'Select All (Pixels)' },
      { id: 'select.none', label: 'Deselect Pixels', accel: 'CmdOrCtrl+Shift+D' },
      { id: 'select.invert', label: 'Invert Pixel Selection', accel: 'CmdOrCtrl+Shift+I' },
      { id: 'select.subject', label: 'Select Subject', accel: 'CmdOrCtrl+Alt+S' },
      { id: 'select.remove-background', label: 'Remove Background' },
      '-',
      { id: 'select.crop', label: 'Crop to Selection' },
      { id: 'select.fill', label: 'Fill Selection' },
      { id: 'select.clear', label: 'Clear Selection Pixels' },
      { id: 'select.copy-to-layer', label: 'Copy Selection to New Layer' },
    ],
  },
  {
    label: 'Document',
    items: [
      { id: 'page.add', label: 'Add Page' },
      { id: 'page.duplicate', label: 'Duplicate Page' },
      { id: 'page.delete', label: 'Delete Page' },
      { id: 'page.prev', label: 'Previous Page' },
      { id: 'page.next', label: 'Next Page' },
      '-',
      { id: 'master.add', label: 'Add Master Page' },
      { id: 'text.link', label: 'Link Text Frames' },
      { id: 'text.unlink', label: 'Unlink Text Frame' },
      '-',
      { id: 'doc.resize', label: 'Resize Document…' },
      { id: 'doc.clear-guides', label: 'Clear Guides' },
    ],
  },
  {
    label: 'View',
    items: [
      { id: 'view.zoom-in', label: 'Zoom In', accel: 'CmdOrCtrl+=' },
      { id: 'view.zoom-out', label: 'Zoom Out', accel: 'CmdOrCtrl+-' },
      { id: 'view.zoom-fit', label: 'Zoom to Fit', accel: 'CmdOrCtrl+0' },
      { id: 'view.zoom-100', label: 'Actual Size', accel: 'CmdOrCtrl+1' },
      '-',
      { id: 'view.rulers', label: 'Toggle Rulers', accel: 'CmdOrCtrl+R' },
      { id: 'view.snapping', label: 'Toggle Snapping', accel: 'CmdOrCtrl+;' },
      '-',
      { id: 'studio.photo', label: 'Photo Studio', accel: 'CmdOrCtrl+Alt+1', feature: 'photo' },
      { id: 'studio.vector', label: 'Vector Studio', accel: 'CmdOrCtrl+Alt+2', feature: 'vector' },
      { id: 'studio.layout', label: 'Layout Studio', accel: 'CmdOrCtrl+Alt+3', feature: 'layout' },
      '-',
      { id: 'view.theme-dark', label: 'Dark Theme' },
      { id: 'view.theme-light', label: 'Light Theme' },
      { id: 'view.theme-contrast', label: 'High Contrast Theme' },
      { id: 'view.ui-bigger', label: 'Larger Interface', accel: 'CmdOrCtrl+Alt+=' },
      { id: 'view.ui-smaller', label: 'Smaller Interface', accel: 'CmdOrCtrl+Alt+-' },
      { id: 'view.ui-reset', label: 'Reset Interface Size' },
      { id: 'view.devtools', label: 'Developer Tools', accel: 'CmdOrCtrl+Alt+I' },
    ],
  },
  {
    label: 'Help',
    items: [
      { id: 'help.shortcuts', label: 'Keyboard Shortcuts', accel: 'F1' },
      { id: 'help.guide', label: 'Quick Start Guide' },
      { id: 'help.check-updates', label: 'Check for Updates…', feature: 'update-check' },
      { id: 'help.about', label: 'About Quvrelo' },
    ],
  },
];

export function allMenuCommands(): MenuCommand[] {
  return APP_MENU.flatMap((s) => s.items.filter((i): i is MenuCommand => i !== '-'));
}

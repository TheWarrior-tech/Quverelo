import type { ReactElement } from 'react';

/**
 * Quvrelo icon set. Drawn for this app on a 20x20 grid (16x16 live area),
 * 1.5 stroke, round caps and joins, currentColor. See docs/DESIGN.md section 7.
 * Rules checked in the a11y/icon audit: path geometry stays within 2.5..17.5
 * (the 1.5 stroke may reach the 2px padding edge); rect radius 1.5, small squares 1;
 * path corners use 1-unit arcs; node/anchor squares are 3x3.
 */
const P = (d: string) => <path d={d} />;
const R = (x: number, y: number, w: number, h: number, r = 1.5, extra: object = {}) => <rect x={x} y={y} width={w} height={h} rx={r} {...extra} />;
const DASH = { strokeDasharray: '2 2.2' };

const paths: Record<string, ReactElement> = {
  // tools
  move: P('M4.5 3.5l11 4.6-4.7 1.6-1.7 4.8z'),
  node: <>{P('M4 16C6.2 7.8 13.8 7.8 16 16')}{R(2.5, 14.5, 3, 3, 1)}{R(14.5, 14.5, 3, 3, 1)}{R(8.5, 4.5, 3, 3, 1)}{P('M10 7.5v2.3')}</>,
  hand: P('M7 10.5V5a1 1 0 012 0v4M9 9V3.8a1 1 0 012 0V9m0-4.3a1 1 0 012 0V10m0-3.5a1 1 0 012 0v5c0 3-2 5.5-5 5.5-2.2 0-3.3-.9-4.6-2.8L3.8 11.7a1 1 0 011.5-1.3L7 12'),
  zoom: <><circle cx="8.5" cy="8.5" r="5.5" />{P('M12.6 12.6L17 17M6.2 8.5h4.6M8.5 6.2v4.6')}</>,
  'marquee-rect': R(3.5, 4.5, 13, 11, 1, DASH),
  'marquee-ellipse': <ellipse cx="10" cy="10" rx="7" ry="5.5" {...DASH} />,
  lasso: P('M6 14.2C3.2 13 2.7 9.6 4.8 7.3 7.3 4.6 13 4 15.6 6.4c2 1.9.9 5-2 6.5-2.2 1.1-5 1.5-7.6 1.3zM6 14.2c-.7 1.2-.4 2.6.9 3.3'),
  crop: P('M6 2.5V14h11.5M2.5 6H14v11.5'),
  brush: P('M16.4 3.6a1.5 1.5 0 010 2.1L10 12.1 7.9 10l6.4-6.4a1.5 1.5 0 012.1 0zM7.9 10.4c-2 0-3.4 1.4-3.4 3.2 0 1-.6 1.9-1.5 2.4 3.2.7 6.6.1 7-3.2'),
  eraser: P('M8 16.5h8.5M4.3 11.7l6.8-6.8a1.5 1.5 0 012.1 0l2.9 2.9a1.5 1.5 0 010 2.1L11 16.5H7.4L4.3 13.4a1.5 1.5 0 010-1.7zM7.6 8.5l5 5'),
  fill: <>{P('M3.5 9.5L9 4l6 6-5.5 5.5z')}{P('M15.8 12.6s1.7 1.8 1.7 3a1.7 1.7 0 01-3.4 0c0-1.2 1.7-3 1.7-3z')}{P('M3.5 9.5h11')}</>,
  eyedropper: P('M11 5.4l3.6 3.6M13.6 4.4l.9-.9a1.7 1.7 0 012.4 2.4l-.9.9zM12.8 7.2L5.5 14.5l-.8 2.8 2.8-.8 7.3-7.3'),
  text: P('M4.5 6V4h11v2M10 4v12.5M7.5 16.5h5'),
  textframe: <>{R(3, 3, 14, 14, 1.5)}{P('M6.5 7h7M6.5 10h7M6.5 13h4')}</>,
  imageframe: <>{R(3, 3, 14, 14, 1.5)}{P('M3.5 3.5l13 13M16.5 3.5l-13 13')}</>,
  pen: <>{P('M4 16.5l1.3-5.6 7.6-7.2 3.5 3.5-7.2 7.6z')}{P('M5.3 10.9l4 4')}<circle cx="8.2" cy="11.8" r="1.2" /></>,
  pencil: P('M12.6 4.4l3 3L7.1 16 3.5 16.5 4 12.9zM11 6l3 3'),
  rect: R(3.5, 4.5, 13, 11, 1.5),
  ellipse: <ellipse cx="10" cy="10" rx="7" ry="5.5" />,
  polygon: P('M10 3l6.6 4.8-2.5 7.7H5.9L3.4 7.8z'),
  star: P('M10 3l2.1 4.4 4.9.7-3.5 3.4.8 4.8L10 14l-4.3 2.3.8-4.8L3 8.1l4.9-.7z'),
  line: P('M4 16L16 4'),

  // pixel selection commands (dashed frame = selection, as the marquee tools)
  'select-all': <>{R(3.5, 3.5, 13, 13, 1, DASH)}{P('M7 10.2l2 2 4-4.2')}</>,
  deselect: <>{R(3.5, 3.5, 13, 13, 1, DASH)}{P('M7.5 7.5l5 5M12.5 7.5l-5 5')}</>,
  'select-invert': <>{R(3.5, 3.5, 13, 13, 1, DASH)}{R(7, 7, 6, 6, 1)}</>,

  // file + edit
  undo: P('M7.5 4L3.5 8l4 4M3.5 8H12a4.5 4.5 0 010 9H8.5'),
  redo: P('M12.5 4l4 4-4 4M16.5 8H8a4.5 4.5 0 000 9h3.5'),
  save: P('M5.5 3.5h7.6l2.4 2.4v9.6a1 1 0 01-1 1h-9a1 1 0 01-1-1v-11a1 1 0 011-1zM7.5 3.5v3.5h5V3.5M7.5 16.5v-4.5h5v4.5'),
  open: P('M3.5 15.5v-10a1 1 0 011-1h3.2l1.6 1.8h5.2a1 1 0 011 1v2.2M3.5 15.5l1.8-6.2a1 1 0 011-.8h10.4a.8.8 0 01.77 1l-1.7 6z'),
  new: P('M11.5 3H5.5a1 1 0 00-1 1v12a1 1 0 001 1h9a1 1 0 001-1V7zM11.5 3v4h4M10 9.5v5M7.5 12h5'),
  export: P('M10 12.5v-9M6.5 6.7L10 3.5l3.5 3.2M4 12v4.5h12V12'),
  image: <>{R(3, 4, 14, 12, 1.5)}<circle cx="7.5" cy="8.5" r="1.4" />{P('M17 13l-4-4-7.5 7')}</>,
  copy: <>{R(7.5, 7.5, 9, 9, 1.5)}{P('M12.5 7.5V5a1 1 0 00-1-1H5a1 1 0 00-1 1v6.5a1 1 0 001 1h2.5')}</>,
  trash: P('M3.5 5.5h13M8 5.5v-2h4v2M5.5 5.5l.8 11h7.4l.8-11M8.5 8.5v5M11.5 8.5v5'),
  plus: P('M10 4v12M4 10h12'),
  close: P('M5 5l10 10M15 5L5 15'),
  folder: P('M3 5.5a1 1 0 011-1h4l1.8 2H16a1 1 0 011 1v7.5a1 1 0 01-1 1H4a1 1 0 01-1-1z'),
  link: P('M8.5 11.5a3 3 0 004.2 0l2.5-2.5a3 3 0 00-4.2-4.2L10 5.8M11.5 8.5a3 3 0 00-4.2 0L4.8 11a3 3 0 004.2 4.2l.9-.9'),
  handin: P('M4 10.5l4 4 8-9'),

  // studios
  photo: <>{R(3, 6, 14, 10, 1.5)}<circle cx="10" cy="11" r="2.8" />{P('M7 6l1-2h4l1 2')}</>,
  vector: <>{P('M4 15.5L10 5l6 10.5')}{R(8.5, 2.5, 3, 3, 1)}{R(2.5, 14.5, 3, 3, 1)}{R(14.5, 14.5, 3, 3, 1)}</>,
  layout: <>{R(3, 3, 14, 14, 1.5)}{P('M3 8h14M8 8v9')}</>,
  pages: <>{R(6, 3, 10.5, 13, 1.5)}{P('M3.5 6.5v10a1 1 0 001 1h8')}</>,

  // visibility, state
  eye: <>{P('M2.5 10s2.9-5.5 7.5-5.5 7.5 5.5 7.5 5.5-2.9 5.5-7.5 5.5S2.5 10 2.5 10z')}<circle cx="10" cy="10" r="2.2" /></>,
  'eye-off': P('M3.5 3.5l13 13M8.3 4.8A7.2 7.2 0 0110 4.5c4.6 0 7.5 5.5 7.5 5.5a14 14 0 01-2.2 3M5.3 5.9A13.6 13.6 0 002.5 10s2.9 5.5 7.5 5.5a7.2 7.2 0 003.4-.9M8.4 8.4a2.2 2.2 0 003.2 3.2'),
  lock: <>{R(4.5, 9, 11, 8, 1.5)}{P('M7 9V6.5a3 3 0 016 0V9')}</>,
  unlock: <>{R(4.5, 9, 11, 8, 1.5)}{P('M7 9V6.5a3 3 0 015.7-1.3')}</>,
  group: <>{R(3, 3, 9, 9, 1)}{R(8, 8, 9, 9, 1)}</>,

  // arrange
  'align-left': <>{P('M3.5 3v14')}{R(6.5, 5, 9, 3.5, 1)}{R(6.5, 11.5, 5.5, 3.5, 1)}</>,
  'align-hcenter': <>{P('M10 3v14')}{R(5, 5, 10, 3.5, 1)}{R(7, 11.5, 6, 3.5, 1)}</>,
  'align-right': <>{P('M16.5 3v14')}{R(4.5, 5, 9, 3.5, 1)}{R(8, 11.5, 5.5, 3.5, 1)}</>,
  'align-top': <>{P('M3 3.5h14')}{R(5, 6.5, 3.5, 9, 1)}{R(11.5, 6.5, 3.5, 5.5, 1)}</>,
  'align-vcenter': <>{P('M3 10h14')}{R(5, 5, 3.5, 10, 1)}{R(11.5, 7, 3.5, 6, 1)}</>,
  'align-bottom': <>{P('M3 16.5h14')}{R(5, 4.5, 3.5, 9, 1)}{R(11.5, 8, 3.5, 5.5, 1)}</>,
  'distribute-h': <>{P('M3.5 3v14M16.5 3v14')}{R(7.5, 5.5, 5, 9, 1)}</>,
  'distribute-v': <>{P('M3 3.5h14M3 16.5h14')}{R(5.5, 7.5, 9, 5, 1)}</>,
  'flip-h': P('M10 3v14M7 6L3 10l4 4zM13 6l4 4-4 4z'),
  'flip-v': P('M3 10h14M6 7l4-4 4 4zM6 13l4 4 4-4z'),
  rotate: P('M16.5 10a6.5 6.5 0 11-1.9-4.6M16.5 3.5v4h-4'),

  // boolean
  'bool-add': P('M3.5 3.5h8v5h5v8h-8v-5h-5z'),
  'bool-subtract': <>{P('M3.5 3.5h8v5h-3v3h-5z')}{R(8.5, 8.5, 8, 8, 1, DASH)}</>,
  'bool-intersect': <>{R(3.5, 3.5, 8, 8, 1, DASH)}{R(8.5, 8.5, 8, 8, 1, DASH)}<rect x="8.5" y="8.5" width="3" height="3" fill="currentColor" stroke="none" /></>,
  'bool-exclude': P('M3.5 3.5h8v5h-3v3h-5zM11.5 8.5h5v8h-8v-5h3z'),
  'bool-divide': <>{R(3.5, 3.5, 8, 8, 1)}{R(8.5, 8.5, 8, 8, 1)}</>,

  // app
  help: <><circle cx="10" cy="10" r="7.5" />{P('M7.9 7.9a2.2 2.2 0 014.3.6c0 1.5-2.2 1.8-2.2 3.3M10 14.2h.01')}</>,
  keyboard: <>{R(2.5, 5, 15, 10, 1.5)}{P('M5.5 8.5h.01M8.5 8.5h.01M11.5 8.5h.01M14.5 8.5h.01M6.5 11.5h7')}</>,
  settings: <>{P('M3.5 6h7.7M14.8 6h1.7M3.5 14h1.7M8.8 14h7.7')}<circle cx="13" cy="6" r="1.8" /><circle cx="7" cy="14" r="1.8" /></>,
  'chevron-left': P('M12.5 4.5L7 10l5.5 5.5'),
  'chevron-right': P('M7.5 4.5L13 10l-5.5 5.5'),
  'chevron-down': P('M4.5 7.5L10 13l5.5-5.5'),
  mask: <>{R(3, 3, 14, 14, 1.5)}<circle cx="10" cy="10" r="3.8" fill="currentColor" stroke="none" /></>,
  adjust: <><circle cx="10" cy="10" r="7" /><path d="M10 3a7 7 0 010 14z" fill="currentColor" stroke="none" /></>,
  stroke: R(4, 4, 12, 12, 1.5, { strokeWidth: 3 }),
  swap: P('M6 3.5l-3 3 3 3M3 6.5h10M14 16.5l3-3-3-3M17 13.5H7'),
  pixel: <>{R(3.5, 3.5, 6, 6, 1)}{R(10.5, 10.5, 6, 6, 1)}{R(10.5, 3.5, 6, 6, 1, DASH)}</>,
  minus: P('M4 10h12'),
  'arrow-up': P('M10 16V4M5.5 8.5L10 4l4.5 4.5'),
  'arrow-down': P('M10 4v12M5.5 11.5L10 16l4.5-4.5'),
  check: P('M4.5 10.5l3.5 3.5 7.5-8'),
  search: <><circle cx="8.5" cy="8.5" r="5" />{P('M12.3 12.3l4.2 4.2')}</>,
  // empty/drop states: a file arriving into a tray
  drop: P('M10 3.5v8M6.8 8.3l3.2 3.2 3.2-3.2M3.5 12v3.5a1 1 0 001 1h11a1 1 0 001-1V12'),
  'circle-check': <><circle cx="10" cy="10" r="7" />{P('M7 10.3l2.1 2.1 4-4.3')}</>,
  circle: <circle cx="10" cy="10" r="7" />,

  // updates: arrow into a tray
  update: P('M10 3.5v9M6.5 9.5l3.5 3.5 3.5-3.5M3.5 13.5v2a1 1 0 001 1h11a1 1 0 001-1v-2'),
  // text alignment
  'text-left': P('M3.5 5h13M3.5 8.3h8M3.5 11.7h13M3.5 15h8'),
  'text-center': P('M3.5 5h13M6 8.3h8M3.5 11.7h13M6 15h8'),
  'text-right': P('M3.5 5h13M8.5 8.3h8M3.5 11.7h13M8.5 15h8'),
  'text-justify': P('M3.5 5h13M3.5 8.3h13M3.5 11.7h13M3.5 15h13'),
};

export function Icon({ name, title, size }: { name: string; title?: string; size?: 16 | 20 }) {
  return (
    <svg className={`icon${size === 16 ? ' sm' : ''}`} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
      {title && <title>{title}</title>}
      {paths[name] ?? paths.rect}
    </svg>
  );
}

/** Flat Quvrelo mark: graphite tile, off-white ring, accent bar as the Q tail. No gradients. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" aria-hidden="true">
      <rect x="2" y="2" width="60" height="60" rx="14" fill="#141516" />
      <rect x="2.5" y="2.5" width="59" height="59" rx="13.5" fill="none" stroke="#ffffff" strokeOpacity="0.14" />
      <circle cx="30" cy="30" r="15" fill="none" stroke="#ececed" strokeWidth="7" />
      <path d="M36.5 36.5L48 48" stroke="#3cc4b0" strokeWidth="7.5" strokeLinecap="butt" />
    </svg>
  );
}

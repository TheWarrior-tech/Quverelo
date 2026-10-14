import type { ReactElement } from 'react';

const P = (d: string) => <path d={d} />;

const paths: Record<string, ReactElement> = {
  move: <>{P('M5 3l13 7-6 1.5L9.5 18z')}</>,
  node: <>{P('M4 18C8 6 16 6 20 18')}<rect x="2.5" y="16.5" width="3" height="3" /><rect x="18.5" y="16.5" width="3" height="3" /><rect x="10.5" y="7" width="3" height="3" /></>,
  hand: <>{P('M8 12V5.5a1.5 1.5 0 013 0V11m0-6.5a1.5 1.5 0 013 0V11m0-5a1.5 1.5 0 013 0v7c0 4-2.5 7-6.5 7-3 0-4.5-1.5-6-4l-2-3.5a1.5 1.5 0 012.5-1.6L8 13')}</>,
  zoom: <><circle cx="10.5" cy="10.5" r="6.5" />{P('M15.5 15.5L21 21M8 10.5h5M10.5 8v5')}</>,
  'marquee-rect': <><rect x="4" y="5" width="16" height="14" strokeDasharray="3 2" /></>,
  'marquee-ellipse': <><ellipse cx="12" cy="12" rx="9" ry="7" strokeDasharray="3 2" /></>,
  lasso: <>{P('M7 17c-3-1.5-4-4-3-6.5C5.5 6 11 4 16 5.5s5 6 1.5 8.5S9 15 7 17zM7 17c-1 1.5-.5 3 1 4')}</>,
  crop: <>{P('M6 2v16h16M2 6h16v16')}</>,
  brush: <>{P('M14.5 4.5l5 5L11 18l-5-5z')}{P('M6 13c-2 0-3.5 1.5-3.5 3.5S1.5 21 1.5 21s3.5 0 5-.5S9 18 9 16')}</>,
  eraser: <>{P('M7 21h13M5.5 15.5l9-9a2 2 0 012.8 0l2.2 2.2a2 2 0 010 2.8L12 19H8z')}{P('M9.5 11.5l5 5')}</>,
  fill: <>{P('M5 11l7-7 7 7-7 7z')}{P('M19 14s2 2.5 2 4a2 2 0 01-4 0c0-1.5 2-4 2-4z')}</>,
  eyedropper: <>{P('M14 4.5l5.5 5.5M16.5 2a2.1 2.1 0 013 3L18 6.5l-1 1L9 15.5 5 19l-1-1 3.5-4 8-8 1-1z')}</>,
  text: <>{P('M5 6V4h14v2M12 4v16M9 20h6')}</>,
  textframe: <><rect x="3" y="3" width="18" height="18" rx="1" />{P('M7 8h10M7 12h10M7 16h6')}</>,
  imageframe: <><rect x="3" y="3" width="18" height="18" rx="1" />{P('M3 3l18 18M21 3L3 21')}</>,
  pen: <>{P('M12 19l7-7 3 3-7 7zM18 13l-1.5-7.5L2 2l3.5 14.5L13 18zM2 2l7.6 7.6')}<circle cx="11" cy="11" r="2" /></>,
  pencil: <>{P('M17 3l4 4L8 20H4v-4z')}</>,
  rect: <><rect x="4" y="5" width="16" height="14" rx="1" /></>,
  ellipse: <><ellipse cx="12" cy="12" rx="9" ry="7" /></>,
  polygon: <>{P('M12 3l8.5 6.2-3.2 10H6.7L3.5 9.2z')}</>,
  star: <>{P('M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z')}</>,
  line: <>{P('M4 20L20 4')}</>,
  undo: <>{P('M9 14L4 9l5-5M4 9h11a5 5 0 010 10h-3')}</>,
  redo: <>{P('M15 14l5-5-5-5M20 9H9a5 5 0 000 10h3')}</>,
  save: <>{P('M5 3h11l3 3v15H5zM8 3v5h7V3M8 21v-7h8v7')}</>,
  open: <>{P('M3 7V5a1 1 0 011-1h5l2 2h8a1 1 0 011 1v2M3 7h18l-2 12H5z')}</>,
  new: <>{P('M14 3H6a1 1 0 00-1 1v16a1 1 0 001 1h12a1 1 0 001-1V8zM14 3v5h5M12 11v6M9 14h6')}</>,
  export: <>{P('M12 3v12M7 8l5-5 5 5M5 15v5h14v-5')}</>,
  image: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" />{P('M21 16l-5-5-9 9')}</>,
  photo: <><rect x="3" y="6" width="18" height="14" rx="2" /><circle cx="12" cy="13" r="3.5" />{P('M8 6l1.5-2.5h5L16 6')}</>,
  vector: <>{P('M4 18L12 4l8 14')}<rect x="10.5" y="2.5" width="3" height="3" /><rect x="2.5" y="16.5" width="3" height="3" /><rect x="18.5" y="16.5" width="3" height="3" /></>,
  layout: <><rect x="3" y="3" width="18" height="18" rx="1" />{P('M3 9h18M9 9v12')}</>,
  eye: <>{P('M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z')}<circle cx="12" cy="12" r="3" /></>,
  'eye-off': <>{P('M3 3l18 18M10.6 5.1A9.6 9.6 0 0112 5c6.5 0 10 7 10 7a17 17 0 01-3 3.8M6.6 6.6A17 17 0 002 12s3.5 7 10 7a9.7 9.7 0 005.4-1.6M9.9 9.9a3 3 0 004.2 4.2')}</>,
  lock: <><rect x="5" y="11" width="14" height="10" rx="2" />{P('M8 11V7a4 4 0 018 0v4')}</>,
  unlock: <><rect x="5" y="11" width="14" height="10" rx="2" />{P('M8 11V7a4 4 0 017.5-2')}</>,
  trash: <>{P('M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13')}</>,
  plus: <>{P('M12 5v14M5 12h14')}</>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" />{P('M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3')}</>,
  group: <><rect x="3" y="3" width="11" height="11" rx="1" /><rect x="10" y="10" width="11" height="11" rx="1" /></>,
  folder: <>{P('M3 6a1 1 0 011-1h5l2 2h9a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1z')}</>,
  'align-left': <>{P('M4 3v18M8 7h10M8 15h6')}<rect x="8" y="5" width="10" height="4" /><rect x="8" y="13" width="6" height="4" /></>,
  'align-hcenter': <>{P('M12 3v18')}<rect x="6" y="5" width="12" height="4" /><rect x="8" y="13" width="8" height="4" /></>,
  'align-right': <>{P('M20 3v18')}<rect x="6" y="5" width="10" height="4" /><rect x="10" y="13" width="6" height="4" /></>,
  'align-top': <>{P('M3 4h18')}<rect x="5" y="8" width="4" height="10" /><rect x="13" y="8" width="4" height="6" /></>,
  'align-vcenter': <>{P('M3 12h18')}<rect x="5" y="6" width="4" height="12" /><rect x="13" y="8" width="4" height="8" /></>,
  'align-bottom': <>{P('M3 20h18')}<rect x="5" y="6" width="4" height="10" /><rect x="13" y="10" width="4" height="6" /></>,
  'distribute-h': <>{P('M4 3v18M20 3v18')}<rect x="9" y="7" width="6" height="10" /></>,
  'distribute-v': <>{P('M3 4h18M3 20h18')}<rect x="7" y="9" width="10" height="6" /></>,
  'bool-add': <>{P('M4 4h10v6h6v10H10v-6H4z')}</>,
  'bool-subtract': <>{P('M4 4h10v6h-4v4H4z')}<rect x="10" y="10" width="10" height="10" strokeDasharray="2 2" /></>,
  'bool-intersect': <><rect x="4" y="4" width="10" height="10" strokeDasharray="2 2" /><rect x="10" y="10" width="10" height="10" strokeDasharray="2 2" /><rect x="10" y="10" width="4" height="4" fill="currentColor" /></>,
  'bool-exclude': <>{P('M4 4h10v6h-4v4H4zM14 10h6v10H10v-6h4z')}</>,
  'bool-divide': <><rect x="4" y="4" width="10" height="10" /><rect x="10" y="10" width="10" height="10" /></>,
  'flip-h': <>{P('M12 3v18M8 7l-5 5 5 5zM16 7l5 5-5 5z')}</>,
  'flip-v': <>{P('M3 12h18M7 8l5-5 5 5zM7 16l5 5 5-5z')}</>,
  rotate: <>{P('M20 12a8 8 0 11-2.3-5.6M20 4v5h-5')}</>,
  help: <><circle cx="12" cy="12" r="9" />{P('M9.5 9.5a2.5 2.5 0 015 .5c0 1.7-2.5 2-2.5 4M12 17h.01')}</>,
  keyboard: <><rect x="2" y="6" width="20" height="12" rx="2" />{P('M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10')}</>,
  settings: <><circle cx="12" cy="12" r="3" />{P('M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z')}</>,
  'chevron-left': <>{P('M15 18l-6-6 6-6')}</>,
  'chevron-right': <>{P('M9 18l6-6-6-6')}</>,
  'chevron-down': <>{P('M6 9l6 6 6-6')}</>,
  close: <>{P('M6 6l12 12M18 6L6 18')}</>,
  mask: <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="12" cy="12" r="5" fill="currentColor" /></>,
  adjust: <><circle cx="12" cy="12" r="9" />{P('M12 3v18')}<path d="M12 3a9 9 0 010 18z" fill="currentColor" /></>,
  link: <>{P('M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1')}</>,
  pages: <><rect x="6" y="3" width="13" height="16" rx="1" />{P('M4 6v14a1 1 0 001 1h11')}</>,
  handin: <>{P('M4 13l4 4 12-12')}{P('M4 20h16')}</>,
  stroke: <><rect x="4" y="4" width="16" height="16" rx="2" strokeWidth="3.5" /></>,
  swap: <>{P('M7 4L3 8l4 4M3 8h13M17 20l4-4-4-4M21 16H8')}</>,
  pixel: <><rect x="4" y="4" width="7" height="7" /><rect x="13" y="13" width="7" height="7" /><rect x="13" y="4" width="7" height="7" strokeDasharray="2 2" /></>,
};

export function Icon({ name, title }: { name: string; title?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
      {title && <title>{title}</title>}
      {paths[name] ?? paths.rect}
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="lg-easel" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ff8a3d" />
          <stop offset="0.5" stopColor="#4a8dff" />
          <stop offset="1" stopColor="#3ecf8e" />
        </linearGradient>
      </defs>
      <rect x="4" y="4" width="56" height="56" rx="14" fill="url(#lg-easel)" />
      <path d="M22 46L32 16l10 30M25.5 36h13M32 46v6" stroke="#fff" strokeWidth="4.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

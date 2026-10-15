/**
 * Built-in templates, including the classroom pack. Templates are pure
 * functions that build a QuvreloDocument with the shared model, so they are
 * validated by unit tests and render identically in every studio.
 */
import { addMaster, addTextFrame, addNodes, linkFrames } from './commands';
import { createDocument, make, makeStroke, solid } from './document';
import { toPx } from './units';
import type { QuvreloDocument, Id, Paint, StudioKind, TextStyle } from './types';

export interface TemplateInfo {
  id: string;
  name: string;
  category: 'Start' | 'Classroom' | 'Print' | 'Digital';
  description: string;
  studio: StudioKind;
  size: string;
  build: () => QuvreloDocument;
}

const A4 = { w: toPx(210, 'mm'), h: toPx(297, 'mm') };
const LETTER = { w: toPx(8.5, 'in'), h: toPx(11, 'in') };
const M = toPx(15, 'mm');

const SANS = 'Inter, Segoe UI, Helvetica, Arial, sans-serif';
const SERIF = 'Georgia, Cambria, "Times New Roman", serif';

class Builder {
  doc: QuvreloDocument;
  constructor(doc: QuvreloDocument) {
    this.doc = doc;
  }
  page(i = 0): Id {
    return this.doc.pages[i].id;
  }
  rect(page: Id, x: number, y: number, w: number, h: number, fill: Paint, extra: Partial<Parameters<typeof make.rect>[0]> = {}) {
    const n = make.rect({ x: x + w / 2, y: y + h / 2, w, h, fill, ...extra });
    this.doc = addNodes(this.doc, page, [n]);
    return n.id;
  }
  ellipse(page: Id, cx: number, cy: number, w: number, h: number, fill: Paint, extra: Partial<Parameters<typeof make.ellipse>[0]> = {}) {
    const n = make.ellipse({ x: cx, y: cy, w, h, fill, ...extra });
    this.doc = addNodes(this.doc, page, [n]);
    return n.id;
  }
  star(page: Id, cx: number, cy: number, size: number, fill: Paint) {
    const n = make.star({ x: cx, y: cy, w: size, h: size, fill });
    this.doc = addNodes(this.doc, page, [n]);
    return n.id;
  }
  line(page: Id, x1: number, y1: number, x2: number, y2: number, color = '#9aa3af', width = 1, dash: number[] = []) {
    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2;
    const n = make.path({
      name: 'Line', x: cx, y: cy, d: [['M', x1 - cx, y1 - cy], ['L', x2 - cx, y2 - cy]],
      stroke: { ...makeStroke(color, width), dash, cap: 'round' },
    });
    this.doc = addNodes(this.doc, page, [n]);
    return n.id;
  }
  frame(page: Id, x: number, y: number, w: number, h: number, text: string, style: Partial<TextStyle>, extra: Record<string, unknown> = {}) {
    const r = addTextFrame(this.doc, page, { x: x + w / 2, y: y + h / 2, w, h, ...extra }, text, style);
    this.doc = r.doc;
    return r.id;
  }
  picture(page: Id, x: number, y: number, w: number, h: number, name = 'Picture Frame') {
    const n = make.imageframe({ x: x + w / 2, y: y + h / 2, w, h, name, fill: solid('#e8ecf2') });
    this.doc = addNodes(this.doc, page, [n]);
    return n.id;
  }
}

function doc(title: string, w: number, h: number, studio: StudioKind, opts: Partial<QuvreloDocument['settings']> = {}, pages = 1) {
  return createDocument({ title, studio, pages, settings: { width: Math.round(w * 100) / 100, height: Math.round(h * 100) / 100, ...opts } });
}

const printOpts = (unit: 'mm' | 'in' = 'mm') => ({
  unit,
  dpi: 300,
  bleed: toPx(3, 'mm'),
  margins: { top: M, right: M, bottom: M, left: M },
});

// ---------------------------------------------------------------------------

function blank(title: string, w: number, h: number, studio: StudioKind, opts: Partial<QuvreloDocument['settings']> = {}) {
  return () => doc(title, w, h, studio, opts);
}

/*
 * Template art direction (design review 1, item 6): each template uses one
 * typeface pairing, at most two colours plus neutrals, no gradients, no
 * clip-art, and realistic placeholder copy a teacher would actually replace.
 */
const INK = '#1c1f24';
const INK_2 = '#4b5059';
const RULE = '#cfd3da';
const PAPER = '#ffffff';

function poster(size: { w: number; h: number }, unit: 'mm' | 'in', title: string): () => QuvreloDocument {
  return () => {
    const b = new Builder(doc(title, size.w, size.h, 'vector', printOpts(unit)));
    const p = b.page();
    const W = size.w;
    const H = size.h;
    const NAVY = '#15233f';
    const CORAL = '#e0654a';
    const x = M * 2;
    b.rect(p, 0, 0, W, H, solid('#f4f1ea'), { name: 'Paper' });
    b.rect(p, 0, 0, W, H * 0.6, solid(NAVY), { name: 'Colour block' });
    b.frame(p, x, H * 0.07, W - 2 * x, 24, 'NORTHFIELD ACADEMY PRESENTS', { fontFamily: SANS, fontSize: W * 0.022, fontWeight: 600, letterSpacing: 120, fill: solid('#aab4c8') });
    b.frame(p, x, H * 0.2, W - 2 * x, H * 0.34, 'Year 8\nScience\nFair', { fontFamily: SANS, fontSize: W * 0.135, fontWeight: 700, lineHeight: 0.98, fill: solid('#ffffff') });
    b.rect(p, x, H * 0.6 - 8, W * 0.18, 16, solid(CORAL), { name: 'Rule' });
    b.frame(p, x, H * 0.65, W - 2 * x, H * 0.058, 'Thursday 14 March', { fontFamily: SANS, fontSize: W * 0.055, fontWeight: 700, fill: solid(NAVY) });
    b.frame(p, x, H * 0.71, W - 2 * x, H * 0.035, '3:30 – 5:30 pm  ·  Main Hall', { fontFamily: SANS, fontSize: W * 0.032, fill: solid(NAVY) });
    b.frame(p, x, H * 0.77, W * 0.62, H * 0.12, 'Thirty projects from Year 8, from water filters to wind turbines. Families are welcome; judging starts at 5 pm.', { fontFamily: SANS, fontSize: W * 0.024, lineHeight: 1.45, fill: solid(INK_2) });
    b.line(p, x, H - M * 2 - 30, W - x, H - M * 2 - 30, '#c9c3b6', 1);
    b.frame(p, x, H - M * 2 - 20, W * 0.4, 24, 'Free entry', { fontFamily: SANS, fontSize: W * 0.022, fontWeight: 600, fill: solid(CORAL) });
    b.frame(p, W * 0.45, H - M * 2 - 20, W * 0.55 - x, 24, 'northfield.sch.uk/sciencefair', { fontFamily: SANS, fontSize: W * 0.022, align: 'right', fill: solid(INK_2) });
    return b.doc;
  };
}

function nameLines(b: Builder, p: Id, y: number, W: number, labels: string[]) {
  const span = (W - 2 * M) / labels.length;
  labels.forEach((l, i) => {
    const x = M + i * span;
    b.frame(p, x, y, 60, 18, l, { fontFamily: SANS, fontSize: 10, fontWeight: 600, fill: solid(INK_2) });
    b.line(p, x + 46, y + 15, x + span - 16, y + 15, RULE, 1);
  });
}

function worksheet(): QuvreloDocument {
  const b = new Builder(doc('Worksheet', A4.w, A4.h, 'layout', printOpts()));
  const p = b.page();
  const W = A4.w;
  const BLUE = '#2f5d9e';
  b.frame(p, M, M + 4, W - 2 * M, 16, 'YEAR 7 MATHS  ·  WORKSHEET 3', { fontFamily: SANS, fontSize: 10, fontWeight: 600, letterSpacing: 80, fill: solid(BLUE) });
  b.frame(p, M, M + 24, W - 2 * M, 40, 'Adding and subtracting fractions', { fontFamily: SANS, fontSize: 26, fontWeight: 700, fill: solid(INK) });
  nameLines(b, p, M + 82, W, ['Name', 'Class', 'Date']);
  b.rect(p, M, M + 116, W - 2 * M, 54, solid('#eef2f8'), { radius: 6, name: 'Instructions' });
  b.frame(p, M + 14, M + 126, W - 2 * M - 28, 36, 'Answer every question in the space given. Show your working and give each answer in its simplest form.', { fontFamily: SANS, fontSize: 11.5, lineHeight: 1.45, fill: solid(INK_2) });
  const qs = [
    'Work out 3/8 + 2/8.',
    'Work out 5/6 − 1/3.',
    'Sam ate 1/4 of a pizza and Priya ate 2/5. How much did they eat altogether?',
    'Which is larger, 3/4 or 5/7? Explain how you know.',
    'A ribbon is 2 1/2 m long. 3/4 m is cut off. How much is left?',
  ];
  let y = M + 196;
  qs.forEach((q, i) => {
    b.frame(p, M, y, 24, 20, String(i + 1), { fontFamily: SANS, fontSize: 13, fontWeight: 700, fill: solid(BLUE) });
    b.frame(p, M + 26, y, W - 2 * M - 80, 36, q, { fontFamily: SANS, fontSize: 13, lineHeight: 1.4, fill: solid(INK) });
    b.frame(p, W - M - 60, y, 60, 18, '[2 marks]', { fontFamily: SANS, fontSize: 10, align: 'right', fill: solid('#8a9099') });
    for (let l = 0; l < 3; l++) b.line(p, M + 26, y + 66 + l * 28, W - M, y + 66 + l * 28, RULE, 1);
    y += 158;
  });
  return b.doc;
}

function certificate(): QuvreloDocument {
  const W = A4.h;
  const H = A4.w; // landscape
  const b = new Builder(doc('Certificate', W, H, 'vector', printOpts()));
  const p = b.page();
  const GOLD = '#a47d3c';
  const NAVY = '#1f2a44';
  b.rect(p, 0, 0, W, H, solid('#fbf8f2'), { name: 'Paper' });
  b.rect(p, 28, 28, W - 56, H - 56, { type: 'none' }, { stroke: makeStroke(GOLD, 1.5), name: 'Border' });
  b.frame(p, 80, 96, W - 160, 20, 'NORTHFIELD ACADEMY', { fontFamily: SANS, fontSize: 13, fontWeight: 600, letterSpacing: 200, align: 'center', fill: solid(GOLD) });
  b.frame(p, 80, 128, W - 160, 64, 'Certificate of Achievement', { fontFamily: SERIF, fontSize: 48, align: 'center', fill: solid(NAVY) });
  b.frame(p, 80, 214, W - 160, 28, 'awarded to', { fontFamily: SERIF, fontSize: 18, italic: true, align: 'center', fill: solid(INK_2) });
  b.frame(p, 80, 246, W - 160, 72, 'Alex Morgan', { fontFamily: SERIF, fontSize: 50, align: 'center', fill: solid(NAVY) });
  b.line(p, W * 0.3, 326, W * 0.7, 326, GOLD, 1);
  b.frame(p, 140, 344, W - 280, 56, 'for outstanding work in Year 9 Art\nSpring term 2026', { fontFamily: SERIF, fontSize: 17, lineHeight: 1.5, align: 'center', fill: solid(INK_2) });
  b.ellipse(p, W / 2, H - 128, 76, 76, { type: 'none' }, { stroke: makeStroke(GOLD, 1.5), name: 'Seal' });
  b.ellipse(p, W / 2, H - 128, 64, 64, { type: 'none' }, { stroke: makeStroke(GOLD, 0.75), name: 'Seal inner' });
  b.frame(p, W / 2 - 38, H - 137, 76, 18, 'MERIT', { fontFamily: SANS, fontSize: 11, fontWeight: 600, letterSpacing: 150, align: 'center', fill: solid(GOLD) });
  b.line(p, 130, H - 112, 370, H - 112, NAVY, 0.75);
  b.frame(p, 130, H - 104, 240, 20, 'Ms R. Patel, Head of Art', { fontFamily: SERIF, fontSize: 13, align: 'center', fill: solid(INK_2) });
  b.line(p, W - 370, H - 112, W - 130, H - 112, NAVY, 0.75);
  b.frame(p, W - 370, H - 104, 240, 20, '20 March 2026', { fontFamily: SERIF, fontSize: 13, align: 'center', fill: solid(INK_2) });
  return b.doc;
}

const LOREM =
  'Welcome to this term\'s newsletter. It has been a busy few weeks, and we are proud of everything our students have achieved. ' +
  'In this issue you will find news from every year group, dates for your diary and a few reminders.\n\n' +
  'Sports day was a huge success. Thank you to every family who came to cheer, and to the volunteers who helped set up the field. ' +
  'Results and photos are on the noticeboard by the main entrance.\n\n' +
  'Our reading challenge continues. Students who read for twenty minutes a day will earn a certificate at the end of term, and the class with the most minutes wins a trip to the library.\n\n' +
  'Coming up: parents\' evening, the winter concert and the science fair. Full details are on page two. ' +
  'Please remember to label uniform, bring a water bottle every day and check bags for letters home.\n\n' +
  'Clubs: art club meets on Tuesdays, coding club on Wednesdays and choir on Thursdays. New members are always welcome, and no experience is needed.\n\n' +
  'The school council has been working on ideas for the playground. They have surveyed every class and will present their plans at the next assembly. ' +
  'Thank you to everyone who shared an idea.\n\n' +
  'Our Year 6 pupils visited the science museum this month. They built simple circuits, tested bridges made from paper and asked the curators brilliant questions. Back in class they wrote reports, and the best ones are displayed in the library.\n\n' +
  'The art department is collecting clean yoghurt pots, cardboard tubes and fabric scraps for a sculpture project. Please send any spare materials in with your child; every little helps.\n\n' +
  'Online safety: we will hold a short workshop for families on keeping children safe online. It will cover privacy settings, healthy screen time and what to do if something goes wrong.\n\n' +
  'Lunch menus for next half term are attached. A vegetarian option is available every day, and our kitchen team can cater for allergies — please speak to the office.\n\n' +
  'Finally, a big thank you to our parents and carers for your continued support. Have a wonderful half term.';

function newsletter(): QuvreloDocument {
  const b = new Builder(doc('Newsletter', A4.w, A4.h, 'layout', { ...printOpts(), columns: 2, columnGutter: toPx(5, 'mm') }, 2));
  const W = A4.w;
  const H = A4.h;
  const GREEN = '#2d5f4a';
  // master page: top rule + footer on every page
  const m = addMaster(b.doc, 'A-Master');
  b.doc = m.doc;
  b.rect(m.masterId, M, M - 8, W - 2 * M, 2, solid(INK), { name: 'Top rule' });
  b.frame(m.masterId, M, H - M + 10, W - 2 * M, 18, 'Northfield News  ·  northfield.sch.uk', { fontFamily: SANS, fontSize: 9, align: 'center', fill: solid('#80858d') });
  b.doc = { ...b.doc, pages: b.doc.pages.map((p) => ({ ...p, masterId: m.masterId })) };
  const p1 = b.page(0);
  const p2 = b.page(1);
  b.frame(p1, M, M + 10, W - 2 * M, 60, 'Northfield News', { fontFamily: SERIF, fontSize: 46, fill: solid(INK) });
  b.frame(p1, M, M + 72, W - 2 * M, 22, 'ISSUE 4  ·  AUTUMN TERM 2026', { fontFamily: SANS, fontSize: 11, letterSpacing: 80, fill: solid(GREEN), fontWeight: 600 });
  b.line(p1, M, M + 102, W - M, M + 102, INK, 0.75);
  b.picture(p1, M, M + 120, W - 2 * M, 250, 'Hero picture');
  const colW = (W - 2 * M - toPx(5, 'mm')) / 2;
  const top = M + 390;
  const f1 = b.frame(p1, M, top, colW, H - top - M - 10, LOREM, { fontFamily: SERIF, fontSize: 12.5, lineHeight: 1.45, align: 'justify', fill: solid(INK) });
  const f2 = b.frame(p1, M + colW + toPx(5, 'mm'), top, colW, H - top - M - 10, '', {});
  const f3 = b.frame(p2, M, M + 20, W - 2 * M, 300, '', {}, { columns: 2, columnGap: toPx(5, 'mm') });
  b.doc = linkFrames(b.doc, f1, f2);
  b.doc = linkFrames(b.doc, f2, f3);
  b.rect(p2, M, M + 340, W - 2 * M, 200, solid('#eef3f0'), { radius: 4, name: 'Dates panel' });
  b.frame(p2, M + 20, M + 356, W - 2 * M - 40, 170, 'Dates for your diary\n\nParents\' evening — Thursday 6 November\nWinter concert — Wednesday 10 December\nScience fair — Friday 12 December\nTerm ends — Friday 19 December', { fontFamily: SANS, fontSize: 14, lineHeight: 1.6, fill: solid(GREEN) });
  b.picture(p2, M, M + 560, (W - 2 * M - 20) / 2, 220, 'Photo 1');
  b.picture(p2, M + (W - 2 * M + 20) / 2, M + 560, (W - 2 * M - 20) / 2, 220, 'Photo 2');
  return b.doc;
}

function slide(): QuvreloDocument {
  const b = new Builder(doc('Presentation Slide', 1920, 1080, 'layout', { margins: { top: 80, right: 120, bottom: 80, left: 120 } }));
  const p = b.page();
  const AMBER = '#e8b04b';
  b.rect(p, 0, 0, 1920, 1080, solid('#14171c'), { name: 'Background' });
  b.frame(p, 120, 120, 1200, 40, 'YEAR 9 BIOLOGY  ·  LESSON 4 OF 6', { fontFamily: SANS, fontSize: 26, fontWeight: 600, letterSpacing: 120, fill: solid(AMBER) });
  b.frame(p, 120, 360, 1500, 150, 'Photosynthesis', { fontFamily: SANS, fontSize: 132, fontWeight: 700, lineHeight: 1.0, fill: solid('#f4f4f2') });
  b.frame(p, 120, 530, 1560, 64, 'How plants turn light, water and carbon dioxide into food', { fontFamily: SANS, fontSize: 40, fill: solid('#a7adb7') });
  b.line(p, 120, 900, 1800, 900, '#3a3f48', 2);
  b.frame(p, 120, 930, 900, 40, 'Mr D. Evans  ·  9C', { fontFamily: SANS, fontSize: 26, fill: solid('#a7adb7') });
  b.frame(p, 1000, 930, 800, 40, 'Tuesday 3 November', { fontFamily: SANS, fontSize: 26, align: 'right', fill: solid('#a7adb7') });
  return b.doc;
}

function social(): QuvreloDocument {
  const b = new Builder(doc('Social Graphic', 1080, 1080, 'vector'));
  const p = b.page();
  const RUST = '#c2462a';
  b.rect(p, 0, 0, 1080, 1080, solid('#f3eee6'), { name: 'Background' });
  b.rect(p, 0, 760, 1080, 320, solid(RUST), { name: 'Colour block' });
  b.frame(p, 80, 96, 920, 40, 'NORTHFIELD ACADEMY', { fontFamily: SANS, fontSize: 30, fontWeight: 600, letterSpacing: 120, fill: solid(RUST) });
  b.frame(p, 80, 230, 920, 350, 'Open\nEvening', { fontFamily: SANS, fontSize: 170, fontWeight: 700, lineHeight: 0.95, fill: solid(INK) });
  b.frame(p, 80, 600, 920, 60, 'Thursday 2 October, 5 – 8 pm', { fontFamily: SANS, fontSize: 46, fill: solid(INK_2) });
  b.frame(p, 80, 860, 920, 60, 'Meet the teachers and tour the school', { fontFamily: SANS, fontSize: 40, fontWeight: 600, fill: solid('#ffffff') });
  b.frame(p, 80, 940, 920, 50, '@northfieldacademy', { fontFamily: SANS, fontSize: 32, fill: solid('#f6d9d0') });
  return b.doc;
}

function lessonPlan(): QuvreloDocument {
  const b = new Builder(doc('Lesson Plan', A4.w, A4.h, 'layout', printOpts()));
  const p = b.page();
  const W = A4.w;
  const SLATE = '#3b5b92';
  b.frame(p, M, M, W - 2 * M, 16, 'LESSON PLAN', { fontFamily: SANS, fontSize: 10, fontWeight: 600, letterSpacing: 80, fill: solid(SLATE) });
  b.frame(p, M, M + 20, W - 2 * M, 36, 'The water cycle', { fontFamily: SANS, fontSize: 26, fontWeight: 700, fill: solid(INK) });
  const fields: [string, string][] = [['Subject', 'Geography'], ['Class', '8R'], ['Date', 'Monday 9 November'], ['Duration', '60 minutes']];
  fields.forEach(([f, v], i) => {
    const x = M + (i % 2) * ((W - 2 * M) / 2);
    const y = M + 70 + Math.floor(i / 2) * 26;
    b.frame(p, x, y, 80, 18, f, { fontFamily: SANS, fontSize: 10.5, fill: solid('#80858d') });
    b.frame(p, x + 80, y, 200, 18, v, { fontFamily: SANS, fontSize: 10.5, fontWeight: 600, fill: solid(INK) });
  });
  b.line(p, M, M + 130, W - M, M + 130, INK, 0.75);
  const sections = ['Learning objectives', 'Success criteria', 'Starter · 10 min', 'Main activity · 35 min', 'Plenary · 10 min', 'Support and challenge', 'Resources'];
  let y = M + 146;
  const h = (A4.h - y - M) / sections.length;
  for (const s of sections) {
    b.frame(p, M, y, W - 2 * M, 18, s, { fontFamily: SANS, fontSize: 11.5, fontWeight: 600, fill: solid(SLATE) });
    b.line(p, M, y + h - 8, W - M, y + h - 8, RULE, 0.75);
    y += h;
  }
  return b.doc;
}

function weeklyPlanner(): QuvreloDocument {
  const W = A4.h;
  const H = A4.w;
  const b = new Builder(doc('Weekly Timetable', W, H, 'layout', printOpts()));
  const p = b.page();
  const BLUE = '#2f5d9e';
  b.frame(p, M, M, W - 2 * M, 34, 'Timetable · Autumn term', { fontFamily: SANS, fontSize: 24, fontWeight: 700, fill: solid(INK) });
  b.frame(p, W - M - 300, M + 8, 300, 20, 'Class 8R  ·  Room S12', { fontFamily: SANS, fontSize: 12, align: 'right', fill: solid(INK_2) });
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const times = ['8:50', '9:50', '11:05', '12:05', '13:45', '14:45'];
  const gx = M + 64;
  const gy = M + 56;
  const cw = (W - gx - M) / days.length;
  const rh = (H - gy - M - 28) / times.length;
  days.forEach((d, i) => {
    b.frame(p, gx + i * cw + 8, gy + 4, cw - 16, 18, d, { fontFamily: SANS, fontSize: 11, fontWeight: 600, fill: solid(BLUE) });
  });
  b.line(p, M, gy + 26, W - M, gy + 26, INK, 0.75);
  times.forEach((t, r) => {
    const y = gy + 28 + r * rh;
    b.frame(p, M, y + 8, 56, 16, `P${r + 1}`, { fontFamily: SANS, fontSize: 11, fontWeight: 600, fill: solid(INK) });
    b.frame(p, M, y + 24, 56, 16, t, { fontFamily: SANS, fontSize: 10, fill: solid('#80858d') });
    b.line(p, M, y + rh, W - M, y + rh, RULE, 0.75);
  });
  for (let c = 1; c < days.length; c++) b.line(p, gx + c * cw, gy + 28, gx + c * cw, gy + 28 + times.length * rh, RULE, 0.75);
  return b.doc;
}

function exitTicket(): QuvreloDocument {
  const b = new Builder(doc('Exit Tickets', A4.w, A4.h, 'layout', printOpts()));
  const p = b.page();
  const W = A4.w;
  const H = A4.h;
  const RED = '#b5452f';
  const ch = (H - 2 * M) / 3;
  for (let i = 0; i < 3; i++) {
    const y = M + i * ch;
    if (i) b.line(p, M, y, W - M, y, '#9aa0a8', 1, [6, 4]);
    b.frame(p, M + 4, y + 18, 300, 16, 'EXIT TICKET', { fontFamily: SANS, fontSize: 10, fontWeight: 600, letterSpacing: 80, fill: solid(RED) });
    b.frame(p, M + 4, y + 36, 400, 26, 'Before you leave today', { fontFamily: SANS, fontSize: 18, fontWeight: 700, fill: solid(INK) });
    b.frame(p, W - M - 214, y + 42, 40, 16, 'Name', { fontFamily: SANS, fontSize: 10, fontWeight: 600, fill: solid(INK_2) });
    b.line(p, W - M - 174, y + 56, W - M - 4, y + 56, RULE, 1);
    b.frame(p, M + 4, y + 78, W - 2 * M, 20, '1   One thing I learned today', { fontFamily: SANS, fontSize: 12, fill: solid(INK) });
    b.line(p, M + 20, y + 120, W - M - 4, y + 120, RULE, 1);
    b.frame(p, M + 4, y + 134, W - 2 * M, 20, '2   One question I still have', { fontFamily: SANS, fontSize: 12, fill: solid(INK) });
    b.line(p, M + 20, y + 176, W - M - 4, y + 176, RULE, 1);
    b.frame(p, M + 4, y + 196, 260, 20, '3   How confident do I feel?', { fontFamily: SANS, fontSize: 12, fill: solid(INK) });
    for (let k = 0; k < 5; k++) {
      const cx = M + 250 + k * 36;
      b.ellipse(p, cx, y + 203, 24, 24, { type: 'none' }, { stroke: makeStroke('#9aa0a8', 1), name: `Score ${k + 1}` });
      b.frame(p, cx - 12, y + 196, 24, 16, String(k + 1), { fontFamily: SANS, fontSize: 10, align: 'center', fill: solid(INK_2) });
    }
  }
  return b.doc;
}

function nameBadges(): QuvreloDocument {
  const b = new Builder(doc('Name Badges', A4.w, A4.h, 'layout', printOpts()));
  const p = b.page();
  const cols = 2;
  const rows = 5;
  const gap = 12;
  const bw = (A4.w - 2 * M - gap) / cols;
  const bh = (A4.h - 2 * M - 4 * gap) / rows;
  const NAVY = '#1f2a44';
  const names = ['Amara', 'Ben', 'Chloe', 'Dev', 'Ella', 'Finn', 'Grace', 'Harvey', 'Isla', 'Jamal'];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = M + c * (bw + gap);
      const y = M + r * (bh + gap);
      b.rect(p, x, y, bw, bh, solid(PAPER), { radius: 6, stroke: makeStroke('#c9cdd4', 0.75), name: 'Badge' });
      b.rect(p, x, y, 6, bh, solid(NAVY), { name: 'Badge edge' });
      b.frame(p, x + 22, y + 18, bw - 40, 14, 'HELLO, MY NAME IS', { fontFamily: SANS, fontSize: 9, fontWeight: 600, letterSpacing: 100, fill: solid('#80858d') });
      b.frame(p, x + 22, y + bh / 2 - 18, bw - 40, 40, names[r * cols + c], { fontFamily: SANS, fontSize: 30, fontWeight: 700, fill: solid(NAVY) });
      b.frame(p, x + 22, y + bh - 32, bw - 40, 14, 'Year 7  ·  Induction day', { fontFamily: SANS, fontSize: 9.5, fill: solid(INK_2) });
    }
  }
  return b.doc;
}

function rulesPoster(): QuvreloDocument {
  const b = new Builder(doc('Classroom Rules', A4.w, A4.h, 'vector', printOpts()));
  const p = b.page();
  const W = A4.w;
  const GREEN = '#2d5f4a';
  b.rect(p, 0, 0, W, A4.h, solid('#f6f4ee'), { name: 'Background' });
  b.frame(p, M * 2, M * 2, W - 4 * M, 18, 'ROOM 14', { fontFamily: SANS, fontSize: 12, fontWeight: 600, letterSpacing: 120, fill: solid(GREEN) });
  b.frame(p, M * 2, M * 2 + 24, W - 4 * M, 110, 'How we work\nin this room', { fontFamily: SANS, fontSize: 44, fontWeight: 700, lineHeight: 1.05, fill: solid(INK) });
  const rules = ['Be kind, and assume others are too', 'Listen when someone else is speaking', 'Mistakes are how we learn, so try anyway', 'Leave the room tidier than you found it', 'Ask for help as soon as you need it', 'Be ready to start when the bell goes'];
  rules.forEach((r, i) => {
    const y = M * 2 + 180 + i * 128;
    b.line(p, M * 2, y, W - M * 2, y, '#d3cfc4', 1);
    b.frame(p, M * 2, y + 22, 60, 50, String(i + 1).padStart(2, '0'), { fontFamily: SANS, fontSize: 30, fontWeight: 700, fill: solid(GREEN) });
    b.frame(p, M * 2 + 72, y + 26, W - 4 * M - 72, 70, r, { fontFamily: SANS, fontSize: 24, lineHeight: 1.25, fill: solid(INK) });
  });
  return b.doc;
}

function flashcards(): QuvreloDocument {
  const b = new Builder(doc('Flashcards', A4.w, A4.h, 'layout', printOpts(), 2));
  const cols = 2;
  const rows = 4;
  const cw = (A4.w - 2 * M) / cols;
  const ch = (A4.h - 2 * M) / rows;
  const cards: [string, string][] = [
    ['Photosynthesis', 'How plants make glucose from light, water and carbon dioxide'],
    ['Chlorophyll', 'The green pigment that absorbs light energy'],
    ['Stomata', 'Tiny pores on a leaf that let gases in and out'],
    ['Glucose', 'The sugar made by photosynthesis, used for energy'],
    ['Xylem', 'Tubes that carry water up from the roots'],
    ['Phloem', 'Tubes that carry dissolved sugars around the plant'],
    ['Respiration', 'Releasing energy from glucose in every living cell'],
    ['Transpiration', 'Water evaporating from the leaves of a plant'],
  ];
  [0, 1].forEach((pi) => {
    const p = b.page(pi);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        // backs are mirrored left-to-right so they line up when printed double-sided
        const idx = r * cols + (pi === 0 ? c : cols - 1 - c);
        const x = M + c * cw;
        const y = M + r * ch;
        b.rect(p, x + 4, y + 4, cw - 8, ch - 8, solid(PAPER), { radius: 6, stroke: { ...makeStroke('#9aa0a8', 0.75), dash: [4, 4] }, name: 'Card' });
        b.frame(p, x + 20, y + 18, cw - 40, 14, pi === 0 ? `TERM ${idx + 1}` : `ANSWER ${idx + 1}`, { fontFamily: SANS, fontSize: 9, fontWeight: 600, letterSpacing: 80, fill: solid('#80858d') });
        b.frame(p, x + 20, y + ch / 2 - (pi === 0 ? 18 : 24), cw - 40, 56, pi === 0 ? cards[idx][0] : cards[idx][1], { fontFamily: SANS, fontSize: pi === 0 ? 22 : 14, fontWeight: pi === 0 ? 700 : 400, lineHeight: 1.35, align: 'center', fill: solid(INK) });
      }
    }
  });
  return b.doc;
}

function readingLog(): QuvreloDocument {
  const b = new Builder(doc('Reading Log', A4.w, A4.h, 'layout', printOpts()));
  const p = b.page();
  const W = A4.w;
  const BLUE = '#2f5d9e';
  b.frame(p, M, M, W - 2 * M, 16, 'TARGET: 20 MINUTES A DAY', { fontFamily: SANS, fontSize: 10, fontWeight: 600, letterSpacing: 80, fill: solid(BLUE) });
  b.frame(p, M, M + 20, W - 2 * M, 40, 'My reading log', { fontFamily: SANS, fontSize: 28, fontWeight: 700, fill: solid(INK) });
  nameLines(b, p, M + 72, W, ['Name', 'Class']);
  const headers = ['Date', 'Book title and author', 'Pages', 'Minutes', 'Signed'];
  const widths = [0.14, 0.46, 0.12, 0.13, 0.15];
  const tw = W - 2 * M;
  const top = M + 112;
  let x = M;
  headers.forEach((h, i) => {
    const w = widths[i] * tw;
    b.frame(p, x + 6, top + 6, w - 12, 16, h, { fontFamily: SANS, fontSize: 10.5, fontWeight: 600, fill: solid(BLUE) });
    x += w;
  });
  b.line(p, M, top + 28, W - M, top + 28, INK, 0.75);
  const rows = 22;
  const rh = (A4.h - top - 28 - M) / rows;
  for (let r = 1; r <= rows; r++) b.line(p, M, top + 28 + r * rh, W - M, top + 28 + r * rh, RULE, 0.75);
  x = M;
  for (let i = 0; i < widths.length - 1; i++) {
    x += widths[i] * tw;
    b.line(p, x, top + 28, x, top + 28 + rows * rh, RULE, 0.75);
  }
  return b.doc;
}

function photo(): QuvreloDocument {
  return doc('Photo', 1920, 1280, 'photo', { background: '#ffffff', dpi: 300 });
}

export const TEMPLATES: TemplateInfo[] = [
  { id: 'blank-a4', name: 'Blank A4', category: 'Start', description: 'Portrait A4 page with margins and bleed', studio: 'layout', size: '210 × 297 mm', build: blank('Untitled', A4.w, A4.h, 'layout', printOpts()) },
  { id: 'blank-letter', name: 'Blank US Letter', category: 'Start', description: 'Portrait Letter page with margins', studio: 'layout', size: '8.5 × 11 in', build: blank('Untitled', LETTER.w, LETTER.h, 'layout', printOpts('in')) },
  { id: 'photo', name: 'Photo', category: 'Start', description: 'Pixel canvas for photo editing', studio: 'photo', size: '1920 × 1280 px', build: photo },
  { id: 'social', name: 'Social Graphic', category: 'Digital', description: 'Square announcement post', studio: 'vector', size: '1080 × 1080 px', build: social },
  { id: 'slide', name: 'Presentation Slide', category: 'Digital', description: '16:9 lesson title slide', studio: 'layout', size: '1920 × 1080 px', build: slide },
  { id: 'poster-a4', name: 'Event Poster', category: 'Print', description: 'Typographic event poster', studio: 'vector', size: '210 × 297 mm', build: poster(A4, 'mm', 'Event Poster') },
  { id: 'newsletter', name: 'Newsletter', category: 'Print', description: 'Two pages, master page, linked text columns', studio: 'layout', size: 'A4 · 2 pages', build: newsletter },
  { id: 'worksheet', name: 'Worksheet', category: 'Classroom', description: 'Questions with answer lines', studio: 'layout', size: 'A4', build: worksheet },
  { id: 'certificate', name: 'Certificate', category: 'Classroom', description: 'Award certificate, landscape', studio: 'vector', size: 'A4 landscape', build: certificate },
  { id: 'lesson-plan', name: 'Lesson Plan', category: 'Classroom', description: 'Objectives, activities and resources', studio: 'layout', size: 'A4', build: lessonPlan },
  { id: 'timetable', name: 'Weekly Timetable', category: 'Classroom', description: '5-day, 6-period timetable', studio: 'layout', size: 'A4 landscape', build: weeklyPlanner },
  { id: 'exit-ticket', name: 'Exit Tickets', category: 'Classroom', description: 'Three cut-out reflection slips', studio: 'layout', size: 'A4', build: exitTicket },
  { id: 'name-badges', name: 'Name Badges', category: 'Classroom', description: '10 badges per sheet', studio: 'layout', size: 'A4', build: nameBadges },
  { id: 'rules-poster', name: 'Classroom Rules', category: 'Classroom', description: 'Six-rule room poster', studio: 'vector', size: 'A4', build: rulesPoster },
  { id: 'flashcards', name: 'Flashcards', category: 'Classroom', description: 'Double-sided, 8 per sheet', studio: 'layout', size: 'A4 · 2 pages', build: flashcards },
  { id: 'reading-log', name: 'Reading Log', category: 'Classroom', description: 'Daily reading tracker table', studio: 'layout', size: 'A4', build: readingLog },
];

export function templateById(id: string): TemplateInfo | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

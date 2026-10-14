/**
 * Built-in templates, including the classroom pack. Templates are pure
 * functions that build an EaselDocument with the shared model, so they are
 * validated by unit tests and render identically in every studio.
 */
import { addMaster, addTextFrame, addNodes, linkFrames } from './commands';
import { createDocument, make, makeStroke, solid } from './document';
import { toPx } from './units';
import type { EaselDocument, Id, Paint, StudioKind, TextStyle } from './types';

export interface TemplateInfo {
  id: string;
  name: string;
  category: 'Start' | 'Classroom' | 'Print' | 'Digital';
  description: string;
  studio: StudioKind;
  size: string;
  build: () => EaselDocument;
}

const A4 = { w: toPx(210, 'mm'), h: toPx(297, 'mm') };
const LETTER = { w: toPx(8.5, 'in'), h: toPx(11, 'in') };
const M = toPx(15, 'mm');

const SANS = 'Inter, Segoe UI, Helvetica, Arial, sans-serif';
const SERIF = 'Georgia, Cambria, "Times New Roman", serif';
const ROUNDED = '"Atkinson Hyperlegible", Verdana, Tahoma, sans-serif';

class Builder {
  doc: EaselDocument;
  constructor(doc: EaselDocument) {
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

function doc(title: string, w: number, h: number, studio: StudioKind, opts: Partial<EaselDocument['settings']> = {}, pages = 1) {
  return createDocument({ title, studio, pages, settings: { width: Math.round(w * 100) / 100, height: Math.round(h * 100) / 100, ...opts } });
}

const printOpts = (unit: 'mm' | 'in' = 'mm') => ({
  unit,
  dpi: 300,
  bleed: toPx(3, 'mm'),
  margins: { top: M, right: M, bottom: M, left: M },
});

// ---------------------------------------------------------------------------

function blank(title: string, w: number, h: number, studio: StudioKind, opts: Partial<EaselDocument['settings']> = {}) {
  return () => doc(title, w, h, studio, opts);
}

function poster(size: { w: number; h: number }, unit: 'mm' | 'in', title: string): () => EaselDocument {
  return () => {
    const b = new Builder(doc(title, size.w, size.h, 'vector', printOpts(unit)));
    const p = b.page();
    const W = size.w;
    const H = size.h;
    b.rect(p, 0, 0, W, H * 0.58, { type: 'linear', angle: 90, stops: [{ offset: 0, color: '#3a0ca3' }, { offset: 1, color: '#4cc9f0' }] }, { name: 'Background' });
    b.ellipse(p, W * 0.82, H * 0.12, W * 0.5, W * 0.5, solid('rgba(255,255,255,0.12)'), { name: 'Decoration' });
    b.star(p, W * 0.15, H * 0.1, W * 0.12, solid('#ffd166'));
    b.frame(p, M, H * 0.2, W - 2 * M, H * 0.2, 'BIG EVENT\nTITLE HERE', { fontFamily: SANS, fontSize: W * 0.1, fontWeight: 800, lineHeight: 1.05, align: 'center', fill: solid('#ffffff') });
    b.frame(p, M, H * 0.43, W - 2 * M, H * 0.08, 'A short, exciting line about what is happening', { fontFamily: SANS, fontSize: W * 0.035, align: 'center', fill: solid('#e0f2ff') });
    b.frame(p, M, H * 0.62, W - 2 * M, H * 0.06, 'Friday 14 November · 3:30 pm · Main Hall', { fontFamily: SANS, fontSize: W * 0.04, fontWeight: 700, align: 'center', fill: solid('#1b1b3a') });
    b.frame(p, M * 2, H * 0.71, W - 4 * M, H * 0.16, 'Add the details here: who it is for, what to bring and how to sign up. Keep it short so it can be read from across a corridor.', { fontFamily: SANS, fontSize: W * 0.026, lineHeight: 1.4, align: 'center', fill: solid('#3d405b') });
    b.rect(p, W * 0.3, H * 0.89, W * 0.4, H * 0.05, solid('#f72585'), { radius: H * 0.025, name: 'Button' });
    b.frame(p, W * 0.3, H * 0.9, W * 0.4, H * 0.04, 'Everyone welcome!', { fontFamily: SANS, fontSize: W * 0.028, fontWeight: 700, align: 'center', fill: solid('#ffffff') });
    return b.doc;
  };
}

function worksheet(): EaselDocument {
  const b = new Builder(doc('Worksheet', A4.w, A4.h, 'layout', printOpts()));
  const p = b.page();
  const W = A4.w;
  b.rect(p, 0, 0, W, 110, solid('#06aed5'), { name: 'Header band' });
  b.frame(p, M, 28, W - 2 * M, 50, 'Worksheet Title', { fontFamily: ROUNDED, fontSize: 34, fontWeight: 700, fill: solid('#ffffff') });
  b.frame(p, M, 130, 300, 24, 'Name:', { fontFamily: SANS, fontSize: 14, fontWeight: 600 });
  b.line(p, M + 52, 150, M + 320, 150);
  b.frame(p, W - M - 220, 130, 220, 24, 'Date:', { fontFamily: SANS, fontSize: 14, fontWeight: 600 });
  b.line(p, W - M - 175, 150, W - M, 150);
  b.rect(p, M, 175, W - 2 * M, 70, solid('#fff6d6'), { radius: 10, stroke: makeStroke('#f4a261', 1.5), name: 'Instructions box' });
  b.frame(p, M + 16, 186, W - 2 * M - 32, 52, 'Instructions: read each question carefully and write your answer on the lines. Show your working.', { fontFamily: SANS, fontSize: 13, lineHeight: 1.4 });
  let y = 270;
  for (let q = 1; q <= 5; q++) {
    b.ellipse(p, M + 14, y + 12, 28, 28, solid('#4361ee'), { name: `Q${q} badge` });
    b.frame(p, M, y + 3, 28, 20, String(q), { fontFamily: SANS, fontSize: 13, fontWeight: 700, align: 'center', fill: solid('#ffffff') });
    b.frame(p, M + 40, y, W - 2 * M - 40, 26, `Question ${q}: type your question here.`, { fontFamily: SANS, fontSize: 14 });
    for (let l = 0; l < 3; l++) b.line(p, M + 40, y + 58 + l * 30, W - M, y + 58 + l * 30, '#c9ced6', 1);
    y += 160;
  }
  b.frame(p, M, A4.h - M - 18, W - 2 * M, 18, 'Made with Easel Studio', { fontFamily: SANS, fontSize: 9, align: 'right', fill: solid('#9aa3af') });
  return b.doc;
}

function certificate(): EaselDocument {
  const W = A4.h;
  const H = A4.w; // landscape
  const b = new Builder(doc('Certificate', W, H, 'vector', printOpts()));
  const p = b.page();
  b.rect(p, 0, 0, W, H, solid('#fffaf0'), { name: 'Paper' });
  b.rect(p, 24, 24, W - 48, H - 48, { type: 'none' }, { stroke: makeStroke('#b08d57', 6), name: 'Outer border' });
  b.rect(p, 40, 40, W - 80, H - 80, { type: 'none' }, { stroke: makeStroke('#b08d57', 1.5), name: 'Inner border' });
  b.frame(p, 80, 90, W - 160, 70, 'Certificate of Achievement', { fontFamily: SERIF, fontSize: 52, align: 'center', fill: solid('#5a3e1b') });
  b.frame(p, 80, 185, W - 160, 30, 'This certificate is proudly presented to', { fontFamily: SERIF, fontSize: 20, italic: true, align: 'center', fill: solid('#6b5b4a') });
  b.frame(p, 80, 230, W - 160, 70, 'Student Name', { fontFamily: SERIF, fontSize: 56, fontWeight: 700, align: 'center', fill: solid('#1d3557') });
  b.line(p, W * 0.25, 310, W * 0.75, 310, '#b08d57', 1.5);
  b.frame(p, 120, 330, W - 240, 60, 'for outstanding effort and achievement in\nSubject or Activity', { fontFamily: SERIF, fontSize: 20, align: 'center', fill: solid('#3d3d3d') });
  b.star(p, W / 2, H - 150, 90, solid('#e9c46a'));
  b.line(p, 120, H - 110, 380, H - 110, '#5a3e1b', 1);
  b.frame(p, 120, H - 102, 260, 24, 'Teacher', { fontFamily: SERIF, fontSize: 15, align: 'center' });
  b.line(p, W - 380, H - 110, W - 120, H - 110, '#5a3e1b', 1);
  b.frame(p, W - 380, H - 102, 260, 24, 'Date', { fontFamily: SERIF, fontSize: 15, align: 'center' });
  return b.doc;
}

const LOREM =
  'Welcome to this term\'s newsletter! It has been a busy few weeks, and we are proud of everything our students have achieved. ' +
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
  'Finally, a big thank you to our parents and carers for your continued support. Have a wonderful half term!';

function newsletter(): EaselDocument {
  const b = new Builder(doc('Newsletter', A4.w, A4.h, 'layout', { ...printOpts(), columns: 2, columnGutter: toPx(5, 'mm') }, 2));
  const W = A4.w;
  const H = A4.h;
  // master page: header band + footer on every page
  const m = addMaster(b.doc, 'A-Master');
  b.doc = m.doc;
  b.rect(m.masterId, 0, 0, W, 12, solid('#2a9d8f'), { name: 'Top rule' });
  b.frame(m.masterId, M, H - M + 10, W - 2 * M, 18, 'School Newsletter · www.example.sch.uk', { fontFamily: SANS, fontSize: 9, align: 'center', fill: solid('#6b7280') });
  b.doc = { ...b.doc, pages: b.doc.pages.map((p) => ({ ...p, masterId: m.masterId })) };
  const p1 = b.page(0);
  const p2 = b.page(1);
  b.frame(p1, M, M + 10, W - 2 * M, 60, 'The Weekly Easel', { fontFamily: SERIF, fontSize: 46, fontWeight: 700, fill: solid('#264653') });
  b.frame(p1, M, M + 72, W - 2 * M, 22, 'Issue 1 · Autumn Term', { fontFamily: SANS, fontSize: 13, fill: solid('#2a9d8f'), fontWeight: 600 });
  b.line(p1, M, M + 102, W - M, M + 102, '#264653', 2);
  b.picture(p1, M, M + 120, W - 2 * M, 250, 'Hero picture');
  const colW = (W - 2 * M - toPx(5, 'mm')) / 2;
  const top = M + 390;
  const f1 = b.frame(p1, M, top, colW, H - top - M - 10, LOREM, { fontFamily: SERIF, fontSize: 12.5, lineHeight: 1.45, align: 'justify' });
  const f2 = b.frame(p1, M + colW + toPx(5, 'mm'), top, colW, H - top - M - 10, '', {});
  const f3 = b.frame(p2, M, M + 20, W - 2 * M, 300, '', {}, { columns: 2, columnGap: toPx(5, 'mm') });
  b.doc = linkFrames(b.doc, f1, f2);
  b.doc = linkFrames(b.doc, f2, f3);
  b.rect(p2, M, M + 340, W - 2 * M, 200, solid('#e9f5f3'), { radius: 12, name: 'Dates panel' });
  b.frame(p2, M + 20, M + 356, W - 2 * M - 40, 170, 'Dates for your diary\n\n• Parents\' evening — Thursday 6 November\n• Winter concert — Wednesday 10 December\n• Science fair — Friday 12 December\n• Term ends — Friday 19 December', { fontFamily: SANS, fontSize: 14, lineHeight: 1.5, fill: solid('#264653') });
  b.picture(p2, M, M + 560, (W - 2 * M - 20) / 2, 220, 'Photo 1');
  b.picture(p2, M + (W - 2 * M + 20) / 2, M + 560, (W - 2 * M - 20) / 2, 220, 'Photo 2');
  return b.doc;
}

function slide(): EaselDocument {
  const b = new Builder(doc('Presentation Slide', 1920, 1080, 'layout', { margins: { top: 80, right: 100, bottom: 80, left: 100 } }));
  const p = b.page();
  b.rect(p, 0, 0, 1920, 1080, { type: 'linear', angle: 135, stops: [{ offset: 0, color: '#0b132b' }, { offset: 1, color: '#1c2541' }] }, { name: 'Background' });
  b.rect(p, 100, 470, 160, 10, solid('#5bc0be'), { name: 'Accent' });
  b.frame(p, 100, 260, 1300, 200, 'Lesson Title Goes Here', { fontFamily: SANS, fontSize: 96, fontWeight: 800, lineHeight: 1.05, fill: solid('#ffffff') });
  b.frame(p, 100, 510, 1200, 60, 'Subtitle or learning objective', { fontFamily: SANS, fontSize: 40, fill: solid('#9fb3c8') });
  b.frame(p, 100, 940, 800, 40, 'Teacher name · Class · Date', { fontFamily: SANS, fontSize: 26, fill: solid('#6fffe9') });
  b.ellipse(p, 1600, 540, 560, 560, solid('rgba(91,192,190,0.18)'), { name: 'Decoration' });
  return b.doc;
}

function social(): EaselDocument {
  const b = new Builder(doc('Social Graphic', 1080, 1080, 'vector'));
  const p = b.page();
  b.rect(p, 0, 0, 1080, 1080, { type: 'radial', stops: [{ offset: 0, color: '#ffbe0b' }, { offset: 1, color: '#fb5607' }] }, { name: 'Background' });
  b.star(p, 860, 220, 220, solid('#ffffff'));
  b.frame(p, 80, 380, 920, 260, 'Your message\nhere', { fontFamily: SANS, fontSize: 120, fontWeight: 800, lineHeight: 1, fill: solid('#ffffff') });
  b.frame(p, 80, 900, 920, 60, '@yourschool', { fontFamily: SANS, fontSize: 40, fontWeight: 600, fill: solid('#3a0ca3') });
  return b.doc;
}

function lessonPlan(): EaselDocument {
  const b = new Builder(doc('Lesson Plan', A4.w, A4.h, 'layout', printOpts()));
  const p = b.page();
  const W = A4.w;
  b.frame(p, M, M, W - 2 * M, 44, 'Lesson Plan', { fontFamily: ROUNDED, fontSize: 32, fontWeight: 700, fill: solid('#3a0ca3') });
  const fields = ['Subject', 'Year / Class', 'Date', 'Duration'];
  fields.forEach((f, i) => {
    const x = M + (i % 2) * ((W - 2 * M) / 2);
    const y = M + 60 + Math.floor(i / 2) * 34;
    b.frame(p, x, y, 120, 22, f + ':', { fontFamily: SANS, fontSize: 13, fontWeight: 700 });
    b.line(p, x + 110, y + 18, x + (W - 2 * M) / 2 - 20, y + 18);
  });
  const sections = ['Learning objectives', 'Success criteria', 'Starter (5–10 min)', 'Main activity', 'Plenary', 'Differentiation & support', 'Resources'];
  let y = M + 140;
  const h = (A4.h - y - M) / sections.length - 10;
  for (const s of sections) {
    b.rect(p, M, y, W - 2 * M, h, solid('#f5f3ff'), { radius: 8, stroke: makeStroke('#c4b5fd', 1), name: s });
    b.frame(p, M + 12, y + 8, W - 2 * M - 24, 22, s, { fontFamily: SANS, fontSize: 13, fontWeight: 700, fill: solid('#4c1d95') });
    y += h + 10;
  }
  return b.doc;
}

function weeklyPlanner(): EaselDocument {
  const W = A4.h;
  const H = A4.w;
  const b = new Builder(doc('Weekly Timetable', W, H, 'layout', printOpts()));
  const p = b.page();
  b.frame(p, M, M, W - 2 * M, 40, 'Weekly Timetable', { fontFamily: ROUNDED, fontSize: 30, fontWeight: 700, fill: solid('#1d3557') });
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const periods = 6;
  const gx = M + 70;
  const gy = M + 60;
  const cw = (W - gx - M) / days.length;
  const rh = (H - gy - M - 30) / periods;
  const colours = ['#ffadad', '#ffd6a5', '#fdffb6', '#caffbf', '#9bf6ff'];
  days.forEach((d, i) => {
    b.rect(p, gx + i * cw + 3, gy, cw - 6, 26, solid(colours[i]), { radius: 6, name: d });
    b.frame(p, gx + i * cw, gy + 4, cw, 20, d, { fontFamily: SANS, fontSize: 13, fontWeight: 700, align: 'center' });
  });
  for (let r = 0; r < periods; r++) {
    b.frame(p, M, gy + 34 + r * rh + rh / 2 - 10, 60, 20, `P${r + 1}`, { fontFamily: SANS, fontSize: 13, fontWeight: 700, align: 'center', fill: solid('#457b9d') });
    for (let c = 0; c < days.length; c++) {
      b.rect(p, gx + c * cw + 3, gy + 34 + r * rh, cw - 6, rh - 6, solid('#f8f9fa'), { radius: 6, stroke: makeStroke('#dee2e6', 1), name: `${days[c]} P${r + 1}` });
    }
  }
  return b.doc;
}

function exitTicket(): EaselDocument {
  const b = new Builder(doc('Exit Tickets', A4.w, A4.h, 'layout', printOpts()));
  const p = b.page();
  const W = A4.w;
  const H = A4.h;
  const ch = (H - 2 * M) / 3;
  for (let i = 0; i < 3; i++) {
    const y = M + i * ch;
    b.rect(p, M, y + 6, W - 2 * M, ch - 12, solid('#ffffff'), { radius: 12, stroke: { ...makeStroke('#adb5bd', 1.5), dash: [6, 4] }, name: `Ticket ${i + 1}` });
    b.frame(p, M + 20, y + 22, 300, 30, 'Exit Ticket', { fontFamily: ROUNDED, fontSize: 24, fontWeight: 700, fill: solid('#e63946') });
    b.frame(p, W - M - 260, y + 28, 240, 22, 'Name: ____________________', { fontFamily: SANS, fontSize: 12 });
    b.frame(p, M + 20, y + 64, W - 2 * M - 40, 22, '1. One thing I learned today…', { fontFamily: SANS, fontSize: 13 });
    b.line(p, M + 20, y + 106, W - M - 20, y + 106, '#dee2e6');
    b.frame(p, M + 20, y + 120, W - 2 * M - 40, 22, '2. One question I still have…', { fontFamily: SANS, fontSize: 13 });
    b.line(p, M + 20, y + 162, W - M - 20, y + 162, '#dee2e6');
    b.frame(p, M + 20, y + 178, W - 2 * M - 40, 22, 'How confident do I feel?   😟   😐   🙂   😃', { fontFamily: SANS, fontSize: 13 });
  }
  return b.doc;
}

function nameBadges(): EaselDocument {
  const b = new Builder(doc('Name Badges', A4.w, A4.h, 'layout', printOpts()));
  const p = b.page();
  const cols = 2;
  const rows = 5;
  const bw = (A4.w - 2 * M - 12) / cols;
  const bh = (A4.h - 2 * M - 4 * 12) / rows;
  const colours = ['#4cc9f0', '#f72585', '#ffd166', '#06d6a0', '#7209b7'];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = M + c * (bw + 12);
      const y = M + r * (bh + 12);
      b.rect(p, x, y, bw, bh, solid('#ffffff'), { radius: 14, stroke: makeStroke('#ced4da', 1), name: 'Badge' });
      b.rect(p, x, y, bw, 30, solid(colours[r]), { radius: 0, name: 'Badge band' });
      b.frame(p, x, y + 6, bw, 20, 'HELLO, MY NAME IS', { fontFamily: SANS, fontSize: 11, fontWeight: 700, align: 'center', fill: solid('#ffffff'), letterSpacing: 100 });
      b.frame(p, x + 10, y + bh / 2 - 8, bw - 20, 40, 'Name', { fontFamily: ROUNDED, fontSize: 30, fontWeight: 700, align: 'center' });
    }
  }
  return b.doc;
}

function rulesPoster(): EaselDocument {
  const b = new Builder(doc('Classroom Rules', A4.w, A4.h, 'vector', printOpts()));
  const p = b.page();
  const W = A4.w;
  b.rect(p, 0, 0, W, A4.h, solid('#fefae0'), { name: 'Background' });
  b.frame(p, M, M + 10, W - 2 * M, 70, 'Our Classroom Rules', { fontFamily: ROUNDED, fontSize: 44, fontWeight: 700, align: 'center', fill: solid('#bc6c25') });
  const rules = ['Be kind and respectful', 'Listen when others speak', 'Try your best — mistakes help us learn', 'Look after our classroom', 'Ask for help when you need it', 'Have fun learning!'];
  const colours = ['#e63946', '#f4a261', '#2a9d8f', '#457b9d', '#8338ec', '#ff006e'];
  rules.forEach((r, i) => {
    const y = M + 120 + i * 145;
    b.ellipse(p, M + 50, y + 50, 90, 90, solid(colours[i]), { name: `Rule ${i + 1} circle` });
    b.frame(p, M + 5, y + 28, 90, 50, String(i + 1), { fontFamily: ROUNDED, fontSize: 40, fontWeight: 700, align: 'center', fill: solid('#ffffff') });
    b.frame(p, M + 120, y + 30, W - 2 * M - 130, 50, r, { fontFamily: ROUNDED, fontSize: 28, fontWeight: 700, fill: solid('#283618') });
  });
  return b.doc;
}

function flashcards(): EaselDocument {
  const b = new Builder(doc('Flashcards', A4.w, A4.h, 'layout', printOpts(), 2));
  const cols = 2;
  const rows = 4;
  const cw = (A4.w - 2 * M) / cols;
  const ch = (A4.h - 2 * M) / rows;
  [0, 1].forEach((pi) => {
    const p = b.page(pi);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = M + c * cw;
        const y = M + r * ch;
        b.rect(p, x + 4, y + 4, cw - 8, ch - 8, solid(pi === 0 ? '#ffffff' : '#eef6ff'), { radius: 10, stroke: { ...makeStroke('#adb5bd', 1), dash: [4, 4] }, name: 'Card' });
        b.frame(p, x + 16, y + ch / 2 - 20, cw - 32, 44, pi === 0 ? 'Word / Question' : 'Definition / Answer', { fontFamily: ROUNDED, fontSize: pi === 0 ? 24 : 16, fontWeight: pi === 0 ? 700 : 400, align: 'center' });
      }
    }
  });
  return b.doc;
}

function readingLog(): EaselDocument {
  const b = new Builder(doc('Reading Log', A4.w, A4.h, 'layout', printOpts()));
  const p = b.page();
  const W = A4.w;
  b.frame(p, M, M, W - 2 * M, 50, 'My Reading Log', { fontFamily: ROUNDED, fontSize: 36, fontWeight: 700, fill: solid('#2b9348') });
  const headers = ['Date', 'Book title', 'Pages', 'Minutes', 'Signed'];
  const widths = [0.15, 0.45, 0.12, 0.13, 0.15];
  let x = M;
  const tw = W - 2 * M;
  const top = M + 70;
  headers.forEach((h, i) => {
    const w = widths[i] * tw;
    b.rect(p, x, top, w, 30, solid('#80b918'), { stroke: makeStroke('#ffffff', 1), name: h });
    b.frame(p, x, top + 6, w, 20, h, { fontFamily: SANS, fontSize: 13, fontWeight: 700, align: 'center', fill: solid('#ffffff') });
    x += w;
  });
  const rows = 22;
  const rh = (A4.h - top - 30 - M) / rows;
  for (let r = 0; r < rows; r++) {
    x = M;
    widths.forEach((wr) => {
      const w = wr * tw;
      b.rect(p, x, top + 30 + r * rh, w, rh, solid(r % 2 ? '#f1f8e9' : '#ffffff'), { stroke: makeStroke('#c5e1a5', 0.75), name: 'Cell' });
      x += w;
    });
  }
  return b.doc;
}

function photo(): EaselDocument {
  return doc('Photo', 1920, 1280, 'photo', { background: '#ffffff', dpi: 300 });
}

export const TEMPLATES: TemplateInfo[] = [
  { id: 'blank-a4', name: 'Blank A4', category: 'Start', description: 'Portrait A4 page with margins and bleed', studio: 'layout', size: '210 × 297 mm', build: blank('Untitled', A4.w, A4.h, 'layout', printOpts()) },
  { id: 'blank-letter', name: 'Blank US Letter', category: 'Start', description: 'Portrait Letter page with margins', studio: 'layout', size: '8.5 × 11 in', build: blank('Untitled', LETTER.w, LETTER.h, 'layout', printOpts('in')) },
  { id: 'photo', name: 'Photo', category: 'Start', description: 'Pixel canvas for photo editing', studio: 'photo', size: '1920 × 1280 px', build: photo },
  { id: 'social', name: 'Social Graphic', category: 'Digital', description: 'Square post for social media', studio: 'vector', size: '1080 × 1080 px', build: social },
  { id: 'slide', name: 'Presentation Slide', category: 'Digital', description: '16:9 title slide', studio: 'layout', size: '1920 × 1080 px', build: slide },
  { id: 'poster-a4', name: 'A4 Poster', category: 'Print', description: 'Bold event poster', studio: 'vector', size: '210 × 297 mm', build: poster(A4, 'mm', 'A4 Poster') },
  { id: 'poster-letter', name: 'Letter Poster', category: 'Print', description: 'Bold event poster (US Letter)', studio: 'vector', size: '8.5 × 11 in', build: poster(LETTER, 'in', 'Letter Poster') },
  { id: 'newsletter', name: 'Newsletter', category: 'Print', description: 'Two pages, master page, linked text columns', studio: 'layout', size: 'A4 · 2 pages', build: newsletter },
  { id: 'worksheet', name: 'Worksheet', category: 'Classroom', description: 'Questions with answer lines', studio: 'layout', size: 'A4', build: worksheet },
  { id: 'certificate', name: 'Certificate', category: 'Classroom', description: 'Award certificate, landscape', studio: 'vector', size: 'A4 landscape', build: certificate },
  { id: 'lesson-plan', name: 'Lesson Plan', category: 'Classroom', description: 'Objectives, activities and resources', studio: 'layout', size: 'A4', build: lessonPlan },
  { id: 'timetable', name: 'Weekly Timetable', category: 'Classroom', description: '5-day, 6-period timetable', studio: 'layout', size: 'A4 landscape', build: weeklyPlanner },
  { id: 'exit-ticket', name: 'Exit Tickets', category: 'Classroom', description: 'Three cut-out reflection tickets', studio: 'layout', size: 'A4', build: exitTicket },
  { id: 'name-badges', name: 'Name Badges', category: 'Classroom', description: '10 badges per sheet', studio: 'layout', size: 'A4', build: nameBadges },
  { id: 'rules-poster', name: 'Classroom Rules', category: 'Classroom', description: 'Colourful rules poster', studio: 'vector', size: 'A4', build: rulesPoster },
  { id: 'flashcards', name: 'Flashcards', category: 'Classroom', description: 'Double-sided, 8 per sheet', studio: 'layout', size: 'A4 · 2 pages', build: flashcards },
  { id: 'reading-log', name: 'Reading Log', category: 'Classroom', description: 'Daily reading tracker table', studio: 'layout', size: 'A4', build: readingLog },
];

export function templateById(id: string): TemplateInfo | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

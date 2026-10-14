let counter = 0;

/** Short, collision-resistant ids (time + counter + random). */
export function newId(prefix = 'n'): string {
  counter = (counter + 1) % 1679616;
  const rnd = Math.floor(Math.random() * 1679616).toString(36).padStart(4, '0');
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36).padStart(4, '0')}${rnd}`;
}

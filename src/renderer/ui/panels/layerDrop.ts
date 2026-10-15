/**
 * Layers are listed top-first but stored bottom-first. Given the stored index of the dragged
 * layer (`from`, -1 if it lives elsewhere) and of the row it is dropped on (`index`), return
 * the insertion index for moveNodeTo (which removes the layer first).
 * place 'above' = in front of the target in z-order, 'below' = behind it.
 */
export function dropIndex(from: number, index: number, place: 'above' | 'below'): number {
  const shift = from >= 0 && from < index ? 1 : 0;
  return place === 'above' ? index + 1 - shift : index - shift;
}

/** True when dropping would leave the layer where it is. */
export function isNoopDrop(from: number, index: number, place: 'above' | 'below'): boolean {
  return from >= 0 && dropIndex(from, index, place) === from;
}

import { describe, expect, it } from 'vitest';
import { dirName, hasTransparency, imageMime, linkedHref, linkedImageName, svgBaseName } from '../../src/core/svgImages';

describe('SVG export images', () => {
  it('uses JPEG only for opaque images when asked', () => {
    expect(imageMime(false, 'png')).toBe('image/png');
    expect(imageMime(true, 'png')).toBe('image/png');
    expect(imageMime(false, 'jpeg-opaque')).toBe('image/jpeg');
    expect(imageMime(true, 'jpeg-opaque')).toBe('image/png'); // JPEG would lose the transparency
  });
  it('detects any transparent pixel', () => {
    expect(hasTransparency(new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 255]))).toBe(false);
    expect(hasTransparency(new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 254]))).toBe(true);
  });
  it('names linked images after the SVG, safely, with relative hrefs', () => {
    expect(svgBaseName('/home/a/Poster - Page 1.svg')).toBe('Poster - Page 1');
    expect(svgBaseName('C:\\work\\Logo.SVG')).toBe('Logo');
    expect(dirName('/home/a/Poster.svg')).toBe('/home/a');
    expect(dirName('C:\\work\\Logo.svg')).toBe('C:\\work');
    expect(linkedImageName('Poster', 2, 'image/jpeg')).toBe('Poster image 2.jpg');
    expect(linkedImageName('a/b:c', 1, 'image/png')).toBe('a-b-c image 1.png');
    expect(linkedHref('Poster image 2.jpg')).toBe('Poster%20image%202.jpg');
  });
});

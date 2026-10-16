// Types for the `hyphen` package (ISC, Liang's algorithm with TeX patterns), used by core/hyphenation.ts.
declare module 'hyphen/hyphen.js' {
  type Hyphenator = (text: string) => string;
  function createHyphenator(patterns: unknown, options?: { hyphenChar?: string; minWordLength?: number; async?: false; exceptions?: string[] }): Hyphenator;
  export default createHyphenator;
}
declare module 'hyphen/patterns/en-gb.js' {
  const patterns: unknown;
  export default patterns;
}
declare module 'hyphen/patterns/en-us.js' {
  const patterns: unknown;
  export default patterns;
}

declare module 'utif' {
  /** One TIFF IFD: tags as `t<number>` arrays, plus sub-IFDs UTIF follows. */
  export interface IFD {
    [tag: `t${number}`]: number[] | string[] | Uint8Array | undefined;
    subIFD?: IFD[];
    exifIFD?: IFD;
    width?: number;
    height?: number;
    data?: Uint8Array;
    isLE?: boolean;
  }
  export function decode(buf: ArrayBuffer): IFD[];
  export function decodeImage(buf: ArrayBuffer, img: IFD, ifds?: IFD[]): void;
  const UTIF: { decode: typeof decode; decodeImage: typeof decodeImage };
  export default UTIF;
}

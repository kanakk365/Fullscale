// The pixel size of a picture, read from its header, so a plan picture can be added
// without decoding it. PNG and JPEG are supported.

export interface PictureInfo {
  type: 'png' | 'jpeg';
  width: number;
  height: number;
}

export function pictureInfo(data: Buffer): PictureInfo {
  if (data.length >= 24 && data.readUInt32BE(0) === 0x89504e47 && data.readUInt32BE(4) === 0x0d0a1a0a) {
    return { type: 'png', width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  }
  if (data.length >= 4 && data[0] === 0xff && data[1] === 0xd8) {
    // Walk the JPEG segments to the frame header, which holds the size.
    let at = 2;
    while (at + 9 < data.length) {
      if (data[at] !== 0xff) {
        at++;
        continue;
      }
      const marker = data[at + 1]!;
      const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isFrame) return { type: 'jpeg', height: data.readUInt16BE(at + 5), width: data.readUInt16BE(at + 7) };
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        at += 2;
        continue;
      }
      at += 2 + data.readUInt16BE(at + 2);
    }
    throw new Error('the JPEG has no frame header');
  }
  throw new Error('only PNG and JPEG pictures are supported');
}

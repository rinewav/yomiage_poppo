declare module 'prism-media' {
  import { Transform } from 'stream';

  class OpusEncoder extends Transform {
    constructor(options?: object);
  }

  class OpusDecoder extends Transform {
    constructor(options?: object);
  }

  class FFmpeg extends Transform {
    constructor(options?: object);
  }
}
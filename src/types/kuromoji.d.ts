declare module 'kuromoji' {
  interface IpadicFeatures {
    surface_form: string;
    pos: string;
    pos_detail_1: string;
    pos_detail_2: string;
    pos_detail_3: string;
    conjugated_type: string;
    conjugated_form: string;
    basic_form: string;
    reading: string;
    pronunciation: string;
  }

  interface Tokenizer {
    tokenize(text: string): IpadicFeatures[];
  }

  interface KuromojiBuilder {
    build(callback: (err: Error | null, tokenizer: Tokenizer) => void): void;
  }

  function builder(options: { dicPath: string }): KuromojiBuilder;
}
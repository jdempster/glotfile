declare module "nspell" {
  interface NSpell {
    correct(word: string): boolean;
    suggest(word: string): string[];
    add(word: string, model?: string): NSpell;
    personal(dic: string): NSpell;
  }
  function nspell(dictionary: { aff: Uint8Array | Buffer | string; dic?: Uint8Array | Buffer | string }): NSpell;
  export default nspell;
}

declare module "dictionary-*" {
  const dict: { aff: Uint8Array; dic: Uint8Array };
  export default dict;
}

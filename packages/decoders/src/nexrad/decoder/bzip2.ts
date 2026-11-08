import { Memory } from '../../internal/memory.ts';
/** Dependency-free bzip2 for NEXRAD compression records. No randomized blocks. */
class Bits {
  private pos = 0;
  private bits = 0;
  private value = 0;
  private readonly input: Uint8Array;
  constructor(input: Uint8Array) { this.input = input; }
  read(n: number): number {
    while (this.bits < n) {
      if (this.pos === this.input.length) throw new Error('Truncated bzip2 stream');
      this.value = (this.value << 8) | this.input[this.pos++];
      this.bits += 8;
    }
    this.bits -= n;
    return (this.value >>> this.bits) & ((1 << n) - 1);
  }
  u32(): number { return (this.read(16) * 65536 + this.read(16)) >>> 0; }
  finish() {
    if (this.pos !== this.input.length || (this.value & ((1 << this.bits) - 1)) !== 0)
      throw new Error('Trailing bzip2 data');
  }
}
const crcTable = Uint32Array.from({ length: 256 }, (_, i) => {
  let c = i << 24;
  for (let j = 0; j < 8; j++) c = (c << 1) ^ (c < 0 ? 0x04c11db7 : 0);
  return c >>> 0;
});
interface Huffman { min: number; max: number; base: Int32Array; limit: Int32Array; perm: Uint16Array }
function table(lengths: Uint8Array, memory: Memory): Huffman {
  let min = 20, max = 1;
  for (const n of lengths) { min = Math.min(min, n); max = Math.max(max, n); }
  const base = memory.array(Int32Array, 23), limit = memory.array(Int32Array, 23), perm = memory.array(Uint16Array, lengths.length);
  let k = 0;
  for (let n = min; n <= max; n++) for (let i = 0; i < lengths.length; i++) if (lengths[i] === n) perm[k++] = i;
  for (const n of lengths) base[n + 1]++;
  for (let i = 1; i < base.length; i++) base[i] += base[i - 1];
  let v = 0;
  for (let n = min; n <= max; n++) { v += base[n + 1] - base[n]; limit[n] = v - 1; v <<= 1; }
  for (let n = min + 1; n <= max; n++) base[n] = ((limit[n - 1] + 1) << 1) - base[n];
  return { min, max, base, limit, perm };
}

export class Bzip2Decoder {
  // Reused across compression records: one byte per BWT symbol, four per LF link.
  private last = new Uint8Array(0);
  private links = new Uint32Array(0);
  private output: Uint8Array;
  private memory: Memory;
  constructor();
    /** @internal */
    constructor(memory?: Memory);
    constructor(memory = new Memory()) { this.memory = memory; this.output = memory.array(Uint8Array, 1024 * 1024); }
  get workspaceBytes() { return this.last.byteLength + this.links.byteLength + this.output.byteLength; }
  decode(input: Uint8Array, sink: (bytes: Uint8Array) => void, maxOutput = 16 * 1024 * 1024): number {
    const memory = this.memory;
    const b = new Bits(input);
    if (b.read(24) !== 0x425a68) throw new Error('Expected BZh bzip2 record');
    const level = b.read(8) - 48;
    if (level < 1 || level > 9) throw new Error('Invalid bzip2 block size');
    const capacity = level * 100000;
    if (this.last.length < capacity) { memory.release(this.last); memory.release(this.links); this.last = new Uint8Array(0); this.links = new Uint32Array(0); this.last = memory.array(Uint8Array, capacity); this.links = memory.array(Uint32Array, capacity); }
    let combined = 0, total = 0;
    for (;;) {
      const magic1 = b.read(24), magic2 = b.read(24);
      if (magic1 === 0x177245 && magic2 === 0x385090) {
        if (b.u32() !== (combined >>> 0)) throw new Error('bzip2 combined CRC mismatch');
        b.finish(); return total;
      }
      if (magic1 !== 0x314159 || magic2 !== 0x265359) throw new Error('Invalid bzip2 block magic');
      const expectedCrc = b.u32();
      if (b.read(1)) throw new Error('Randomized legacy bzip2 blocks unsupported');
      const origin = b.read(24), usedGroups = b.read(16);
      const alphabet: number[] = [];
      for (let group = 0; group < 16; group++) if (usedGroups & (0x8000 >>> group)) {
        const mask = b.read(16);
        for (let j = 0; j < 16; j++) if (mask & (0x8000 >>> j)) alphabet.push(group * 16 + j);
      }
      if (!alphabet.length) throw new Error('Empty bzip2 alphabet');
      const groups = b.read(3), count = b.read(15);
      if (groups < 2 || groups > 6 || count < 1 || count > 18002) throw new Error('Invalid bzip2 selectors');
      const selectors = memory.array(Uint8Array, count), mtfGroups = [0, 1, 2, 3, 4, 5];
      for (let i = 0; i < count; i++) {
        let j = 0;
        while (b.read(1)) if (++j >= groups) throw new Error('Invalid selector MTF');
        const g = mtfGroups[j];
        for (; j > 0; j--) mtfGroups[j] = mtfGroups[j - 1];
        mtfGroups[0] = g; selectors[i] = g;
      }
      const tables: Huffman[] = [];
      for (let g = 0; g < groups; g++) {
        let length = b.read(5);
        const lengths = memory.array(Uint8Array, alphabet.length + 2);
        for (let i = 0; i < lengths.length; i++) {
          while (b.read(1)) { length += b.read(1) ? -1 : 1; if (length < 1 || length > 20) throw new Error('Invalid Huffman length'); }
          if (length < 1 || length > 20) throw new Error('Invalid Huffman length');
          lengths[i] = length;
        }
        tables.push(table(lengths, memory));
        memory.release(lengths);
      }
      let selector = 0, left = 0, h = tables[0];
      const symbol = (): number => {
        if (left === 0) {
          if (selector >= selectors.length) throw new Error('Exhausted bzip2 selectors');
          h = tables[selectors[selector++]]; left = 50;
        }
        left--;
        let n = h.min, code = b.read(n);
        while (code > h.limit[n]) { if (++n > h.max) throw new Error('Invalid Huffman code'); code = (code << 1) | b.read(1); }
        const index = code - h.base[n];
        if (index < 0 || index >= h.perm.length) throw new Error('Invalid Huffman index');
        return h.perm[index];
      };
      const mtf = memory.array(Uint8Array, alphabet.length); mtf.set(alphabet);
      const frequencies = memory.array(Uint32Array, 256);
      let size = 0, s = symbol();
      const end = alphabet.length + 1;
      while (s !== end) {
        if (s < 2) {
          let run = 0, power = 1;
          do {
            run += (s + 1) * power; power *= 2;
            if (run > capacity - size) throw new Error('bzip2 run exceeds block');
            s = symbol();
          } while (s < 2);
          const c = mtf[0]; this.last.fill(c, size, size + run); frequencies[c] += run; size += run;
        } else {
          if (s > end || size >= capacity) throw new Error('Invalid bzip2 symbol');
          let j = s - 1;
          const c = mtf[j];
          for (; j > 0; j--) mtf[j] = mtf[j - 1];
          mtf[0] = c; this.last[size++] = c; frequencies[c]++; s = symbol();
        }
      }
      if (origin >= size) throw new Error('Invalid BWT origin');
      const starts = memory.array(Uint32Array, 256);
      for (let i = 1; i < 256; i++) starts[i] = starts[i - 1] + frequencies[i - 1];
      for (let i = 0; i < size; i++) { const c = this.last[i]; this.links[starts[c]++] = (i << 8) | c; }
      let p = origin, previous = -1, repeats = 0, written = 0, crc = 0xffffffff;
      const emit = (c: number) => {
        if (total + written >= maxOutput) throw new Error('bzip2 output exceeds record limit');
        this.output[written++] = c;
        crc = (crc << 8) ^ crcTable[((crc >>> 24) ^ c) & 255];
        if (written === this.output.length) { sink(this.output); total += written; written = 0; }
      };
      for (let i = 0; i < size; i++) {
        const entry = this.links[p], c = entry & 255; p = entry >>> 8;
        if (repeats === 4) { for (let j = 0; j < c; j++) emit(previous); previous = -1; repeats = 0; }
        else { emit(c); repeats = c === previous ? repeats + 1 : 1; previous = c; }
      }
      if (repeats === 4) throw new Error('Truncated bzip2 RLE');
      if (((~crc) >>> 0) !== expectedCrc) throw new Error('bzip2 block CRC mismatch');
      // Earlier full output buffers are provisional until decode() verifies both CRCs.
      if (written) { sink(this.output.subarray(0, written)); total += written; }
      memory.release(selectors); memory.release(mtf); memory.release(frequencies); memory.release(starts);
      for (const t of tables) { memory.release(t.base); memory.release(t.limit); memory.release(t.perm); }
      combined = ((combined << 1) | (combined >>> 31)) ^ expectedCrc;
    }
  }
}

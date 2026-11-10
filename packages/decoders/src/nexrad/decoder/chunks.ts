import type { NexradDecoder } from './decoder.ts';

/** S3 objects must arrive in sequence; no unbounded reorder queue or silent duplicates.
 * A retry is safe before begin(), or by constructing a new decoder and replaying from S.
 */
export class ChunkSequence {
  private volume = '';
  private next = 1;
  private active = false;
  private last = false;
  private complete = false;
  readonly decoder: NexradDecoder;
  constructor(decoder: NexradDecoder) { this.decoder = decoder; }
  begin(key: string) {
    if (this.active || this.complete) throw new Error('Chunk active or volume complete');
    const match = /(?:^|\/)(\d{8}-\d{6})-(\d{3})-([SIE])$/.exec(key);
    if (!match) throw new Error('Invalid NEXRAD chunk key');
    const [, timestamp, sequence, marker] = match;
    const volume = key.slice(0, key.lastIndexOf(timestamp)) + timestamp;
    if (Number(sequence) !== this.next || (this.volume && volume !== this.volume)) throw new Error('Duplicate, out-of-order, or wrong-volume chunk');
    if ((this.next === 1) !== (marker === 'S')) throw new Error('Expected initial S chunk only once');
    this.volume = volume; this.active = true; this.last = marker === 'E';
  }
  push(bytes: Uint8Array) {
    if (!this.active) throw new Error('Call begin(key) before chunk bytes');
    this.decoder.push(bytes);
  }
  end() {
    if (!this.active) throw new Error('No active chunk');
    this.active = false; this.next++;
    if (this.last) { this.decoder.finish(); this.complete = true; }
  }
  finish() { if (!this.complete) throw new Error('Missing final E chunk'); }
}

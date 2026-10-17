import { ApiError } from './errors';

/** Fixed-size UTF-8 byte ring. Cursors belong to one session, never a screen snapshot. */
export class TerminalLog {
  private readonly bytes: Buffer;
  private end = 0;
  constructor(readonly capacity = 262144) {
    if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 1048576)
      throw new Error('Invalid terminal log capacity');
    this.bytes = Buffer.alloc(capacity);
  }
  append(text: string) {
    const length = Buffer.byteLength(text, 'utf8');
    if (!Number.isSafeInteger(this.end + length))
      throw new ApiError('UNAVAILABLE', 'Terminal cursor limit reached.', 'Open a new session.');
    if (!length) return;
    // Encode only a bounded suffix even if a provider emits one enormous string.
    let start = Math.max(0, text.length - this.capacity);
    const first = text.charCodeAt(start);
    if (start > 0 && first >= 0xdc00 && first <= 0xdfff) {
      const previous = text.charCodeAt(start - 1);
      if (previous >= 0xd800 && previous <= 0xdbff) start--;
    }
    const encoded = Buffer.from(text.slice(start), 'utf8');
    const retained = Math.min(encoded.length, this.capacity);
    this.end += length;
    const position = (this.end - retained) % this.capacity;
    const firstPart = Math.min(retained, this.capacity - position);
    encoded.copy(
      this.bytes,
      position,
      encoded.length - retained,
      encoded.length - retained + firstPart,
    );
    if (firstPart < retained) encoded.copy(this.bytes, 0, encoded.length - retained + firstPart);
  }
  read(after = 0, limitBytes = 16384) {
    if (
      !Number.isSafeInteger(after) ||
      after < 0 ||
      after > this.end ||
      !Number.isSafeInteger(limitBytes) ||
      limitBytes < 1 ||
      limitBytes > 65536
    )
      throw new ApiError(
        'INVALID_ARGUMENT',
        'Invalid terminal cursor or byte limit.',
        'Use this session’s returned cursor and a byte limit from 1 to 65536.',
      );
    const firstCursor = Math.max(0, this.end - this.capacity);
    const offset = Math.max(after, firstCursor);
    const length = Math.min(limitBytes, this.end - offset);
    const result = Buffer.alloc(length);
    const position = offset % this.capacity;
    const firstPart = Math.min(length, this.capacity - position);
    this.bytes.copy(result, 0, position, position + firstPart);
    if (firstPart < length) this.bytes.copy(result, firstPart, 0, length - firstPart);
    return {
      encoding: 'base64' as const,
      textEncoding: 'utf-8' as const,
      data: result.toString('base64'),
      offset,
      nextCursor: offset + length,
      latestCursor: this.end,
      firstCursor,
      gap: after < firstCursor,
      lostBytes: Math.max(0, firstCursor - after),
      retainedBytes: this.end - firstCursor,
    };
  }
}

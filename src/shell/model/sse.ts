/** Streaming SSE parser: chunk boundaries, CRLF, multiline data and comments are not message boundaries. */
export class SSEDecoder {
  private decoder = new TextDecoder(); private buffer = ''; private event = 'message'; private data: string[] = [];
  constructor(private emit: (event: string, data: string) => void) {}
  feed(chunk: Uint8Array) {
    this.buffer += this.decoder.decode(chunk, { stream: true });
    if (this.buffer.length > 2_000_000) throw new Error('SSE frame exceeds limit');
    let newline: number;
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline).replace(/\r$/, ''); this.buffer = this.buffer.slice(newline + 1);
      if (!line) { if (this.data.length) this.emit(this.event, this.data.join('\n')); this.event = 'message'; this.data = []; }
      else if (!line.startsWith(':')) {
        const colon = line.indexOf(':'), field = colon < 0 ? line : line.slice(0, colon);
        const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
        if (field === 'event') this.event = value;
        if (field === 'data') this.data.push(value);
        if (this.data.reduce((n, v) => n + v.length, 0) > 2_000_000) throw new Error('SSE frame exceeds limit');
      }
    }
  }
}

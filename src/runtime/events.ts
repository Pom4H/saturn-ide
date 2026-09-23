/** Reconnect sends a fresh snapshot, not an unbounded replay queue. */
export class Events {
  private clients = new Set<ReadableStreamDefaultController<Uint8Array>>();
  private encoder = new TextEncoder();
  private sequence = 0;
  private heartbeat = setInterval(() => this.broadcast(": heartbeat\n\n"), 15000);
  private broadcast(message: string) {
    for (const client of this.clients) {
      try {
        if ((client.desiredSize ?? 0) < -4) { client.close(); this.clients.delete(client); }
        else client.enqueue(this.encoder.encode(message));
      } catch { this.clients.delete(client); }
    }
  }
  emit(event: string, data: unknown) { this.broadcast(`id: ${++this.sequence}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`); }
  response(request: Request, snapshot: unknown) {
    let client: ReadableStreamDefaultController<Uint8Array>;
    const remove = () => { if (client) this.clients.delete(client); };
    const abort = () => { remove(); try { client?.close(); } catch { /* already closed */ } };
    const stream = new ReadableStream<Uint8Array>({
      start: controller => {
        client = controller;
        if (request.signal.aborted) { controller.close(); return; }
        this.clients.add(controller);
        controller.enqueue(this.encoder.encode(`retry: 1500\nevent: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`));
        request.signal.addEventListener("abort", abort, { once: true });
      },
      cancel: () => { remove(); request.signal.removeEventListener("abort", abort); },
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" } });
  }
  get count() { return this.clients.size; }
  close() { clearInterval(this.heartbeat); for (const c of this.clients) { try { c.close(); } catch { /* disconnected */ } } this.clients.clear(); }
}

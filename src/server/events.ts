// A tiny server-sent-events fan-out: connected UI clients subscribe a send
// function, and the watcher broadcasts to all of them. Transport-agnostic so it's
// trivially testable without a live HTTP stream.
export type EventSender = (event: string, data: string) => void;

export interface EventHub {
  subscribe(send: EventSender): () => void;
  broadcast(event: string, data: string): void;
  size(): number;
}

export function createEventHub(): EventHub {
  const senders = new Set<EventSender>();
  return {
    subscribe(send) {
      senders.add(send);
      return () => senders.delete(send);
    },
    broadcast(event, data) {
      for (const send of [...senders]) {
        // One dead/slow client must not block or break delivery to the others.
        try {
          send(event, data);
        } catch { /* drop — the stream's own abort handler unsubscribes it */ }
      }
    },
    size() {
      return senders.size;
    },
  };
}

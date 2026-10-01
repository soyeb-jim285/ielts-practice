import { EventEmitter } from 'node:events';

/** A stand-in for the upstream OpenAI WebSocket: records what is sent, emits what a test feeds it. */
export function fakeSocket(open = true) {
  const s = Object.assign(new EventEmitter(), {
    sent: [] as string[],
    readyState: (open ? 1 : 0) as 0 | 1 | 2 | 3,
    send(d: string) {
      s.sent.push(d);
    },
    close() {
      s.readyState = 3;
      s.emit('close');
    },
    terminate() {
      s.close();
    },
  });
  return s;
}

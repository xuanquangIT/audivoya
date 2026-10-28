// Port-slot allocation: the lowest free slot N >= 1 whose ports are all bindable on 127.0.0.1.
import net from 'node:net';
import { portsForSlot } from './config.mjs';

/**
 * Probes whether a TCP port can be bound on the loopback interface right now.
 * @param {number} port
 * @param {string} [host]
 * @returns {Promise<boolean>}
 */
export function isPortFree(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen({ port, host, exclusive: true }, () =>
      server.close(() => resolve(true)),
    );
  });
}

/**
 * Picks the lowest slot that no other worktree holds and whose ports are all free.
 * @param {{
 *   ports: import('./config.mjs').WorkspaceConfig['ports'],
 *   taken?: Iterable<number>,
 *   isFree?: (port: number) => boolean | Promise<boolean>,
 * }} options
 * @returns {Promise<number | null>} The slot, or null when every slot is taken or busy.
 */
export async function allocateSlot({ ports, taken = [], isFree = isPortFree }) {
  const used = new Set(taken);
  for (let slot = 1; slot <= ports.maxSlots; slot += 1) {
    if (used.has(slot)) continue;
    const candidates = Object.values(portsForSlot(ports, slot));
    const free = await Promise.all(candidates.map((port) => isFree(port)));
    if (free.every(Boolean)) return slot;
  }
  return null;
}

import type { LiveUsageEvent } from './liveUsage';

export type LiveUsageBuffer = { events: LiveUsageEvent[]; ignored: Set<string> };
export function mergeLiveUsage(buffer: LiveUsageBuffer, incoming: LiveUsageEvent[]): LiveUsageBuffer {
  const map = new Map(buffer.events.map(e => [e.id, e])); incoming.forEach(e => { if (!buffer.ignored.has(e.id)) map.set(e.id, e); });
  return { events: [...map.values()].sort((a, b) => b.occurred_at - a.occurred_at).slice(0, 200), ignored: buffer.ignored };
}
export function clearLiveUsage(buffer: LiveUsageBuffer): LiveUsageBuffer { return { events: [], ignored: new Set([...buffer.ignored, ...buffer.events.map(e => e.id)].slice(-2000)) }; }

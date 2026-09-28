// Tiny event bus shared by every system. See ARCHITECTURE.md for event names.
export class Events {
  constructor() { this.map = new Map(); }
  on(name, fn) { if (!this.map.has(name)) this.map.set(name, new Set()); this.map.get(name).add(fn); return () => this.off(name, fn); }
  off(name, fn) { this.map.get(name)?.delete(fn); }
  emit(name, data) { this.map.get(name)?.forEach((fn) => fn(data)); }
}

// Only package-owned codecs may receive the instance's private allocation context.
const audited = new WeakSet<object>();
export function auditPacking<T extends object>(packing: T): T { audited.add(packing); return packing; }
export function isAuditedPacking(packing: object): boolean { return audited.has(packing); }

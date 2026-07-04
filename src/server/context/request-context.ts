import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Ambient per-request context, carried across the whole async call tree via
 * AsyncLocalStorage so deep code (the audit service) can attribute an event to
 * the originating request WITHOUT threading an IP parameter through every
 * service signature.
 *
 * Bound at the transport edge (the tRPC route handler and the export route),
 * both of which run on the Node.js runtime. It is deliberately NOT used in the
 * edge middleware (no async_hooks there) — that layer only sets headers.
 */
export interface RequestContext {
  /** Best-effort client IP for audit attribution; null when unknown. */
  ipAddress: string | null;
}

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Run `fn` with `context` bound for the duration of its (a)synchronous
 * execution. Anything the returned promise awaits stays inside the same store.
 */
export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

/** The current request's client IP if a context is bound, else null. */
export function getRequestIp(): string | null {
  return storage.getStore()?.ipAddress ?? null;
}

/**
 * Best-effort client IP from request headers. Honours the reverse proxy's
 * `x-forwarded-for` (first hop) then `x-real-ip`. Direct connections have
 * neither and resolve to null. The production proxy (see docs/deployment.md)
 * is responsible for setting these; never trust them for authorization.
 */
export function clientIpFromHeaders(headers: Headers): string | null {
  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || null;
  }
  return headers.get("x-real-ip");
}

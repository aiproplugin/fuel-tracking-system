/**
 * Test-environment defaults. Some modules (e.g. the reports router and the
 * export route) import `@/lib/env`, which fails fast if required variables are
 * missing. Provide safe dummy values so importing the full router tree in a
 * unit test does not require a real .env. Real values (if present) always win.
 *
 * These are NOT secrets and never touch a real database — service-level tests
 * mock `@/server/db`.
 */
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/fuel_tracking_test";
process.env.NEXTAUTH_SECRET ??= "test-only-secret-abcdefghijklmnopqrstuvwxyz-0123456789";
process.env.NEXTAUTH_URL ??= "http://localhost:3000";

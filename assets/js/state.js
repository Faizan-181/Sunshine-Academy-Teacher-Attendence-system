// Shared app state. The session itself lives in an HttpOnly cookie managed by PHP;
// the CSRF token is kept only in memory and re-fetched from /auth/session on page load.
// `today` is the academy's date according to the server (YYYY-MM-DD).
// `dbOutdated` is true when the database was created from an older schema.sql.
export const state = { user: null, csrf: '', today: '', needsSetup: false, dbOutdated: false };

// Preserve the old test entry point using the maintained phone-first and real SSE browser scenarios.
// Both scenarios start their own synthetic HTTP servers and never call a business backend.
await import("./test-h5-phone-entry-browser.mjs");
await import("./test-activity-info-browser.mjs");

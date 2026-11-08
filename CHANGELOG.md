# Changelog

## [1.0.7] — 2026-11-08

### Fixed
- Fixed Property Vault capacity showing `Unknown` after the 1.0.6 fast deposit-form detector returned a smaller form subtree.
- Wallet and stored-vault facts are now read from nearby Vault ancestors first, then from deposit-page text only as a fallback.
- Preserved the faster Vault/Cayman loading path and adaptive alarm behavior from 1.0.6.

## [1.0.6] — 2026-11-08

### Changed
- Added adaptive alarm volume based on total exposed wallet cash.
- Below $100,000 the visual notification remains but the alarm sound is suppressed.
- From $100,000 to $1,000,000 the alarm volume rises progressively.
- At $1,000,000 or above the original full alarm volume is preserved.
- Added a cheap fast-path for Property Vault/Cayman deposit-form detection.
- Expensive text-based context scans remain throttled while exact DEPOSIT-button detection can react immediately.
- Added a temporary deposit-page probe (~80 ms during the first 2.5 seconds, then ~250 ms) so the panel leaves its waiting state promptly when Torn finishes rendering.
- Final DEPOSIT remains manual in the Review build.

## [1.0.5] — 2026-11-08

### Changed
- Reworked multi-tab ownership so correctness no longer depends on a precise 2-second background heartbeat.
- Ownership transfers immediately on focus, visibility, pageshow, and resume events.
- Heartbeat is now 30 seconds with a 180-second crash-recovery lease; delayed background timers no longer look like a dead tab.
- A delayed current owner renews its existing token instead of creating a false handoff.
- Added freeze/resume/pagehide lifecycle handling.
- Reduced global MutationObservers from four to three by merging source-reconnect duties into the UI bootstrap observer.
- The global structural observer now ignores unrelated Torn DOM churn and wakes heavier work only for relevant missing sources/mount points.
- Reduced identical snapshot writes, cached travel fallback scans, cached Notes-anchor searches, coalesced scroll/UI refreshes, and avoided rebuilding unchanged quick-button/corner-switch markup.
- Legacy storage compatibility now runs once through a schema migration instead of on every load.
- Removed unused local API-call bookkeeping while keeping the shared API rate guard.
- Final **DEPOSIT** remains manual in the Review build.

### Development note
- Private 1.0.3/1.0.4 experiments tested a Web Worker clock and performance cleanup. The Worker clock was not promoted to the Review branch; the useful cleanup was retained in 1.0.5.

## [1.0.2] — 2026-11-08

### Fixed
- Added a single shared-state owner for wallet transitions, snapshots and alerts even when no API key is configured.
- All Torn tabs may still observe the DOM, but only the confirmed owner may commit a wallet transition or emit an alarm.
- Rearming SafeSell now starts a new wallet-deduplication cycle, preventing a legitimate repeated transition from being suppressed by a previous session.
- Added request-generation and API-key-revision guards before API callbacks may mutate current state.
- `stopApiMode()` now invalidates stale request callbacks before aborting an in-flight request.
- API backoff, suspension, failure count and status are shared between tabs and tied to the current API-key revision.
- A leadership handoff can no longer bypass a shared 429 cooldown or invalid-key suspension.
- Reduced idle API work when no API key is configured; only shared state-owner coordination remains active.

### Regression note
A real multi-window DOM-only duplicate-alarm loop was observed on v0.9.7 when a scheduled company payment arrived. The exact historical state could not be captured, but the symptom was consistent with multiple tabs processing the same shared transition concurrently. v1.0.2 makes transition ownership single-writer to close that class of race.

## [1.0.1] — 2026-11-08

### Fixed
- Property Vault capacity now uses Torn's fixed **$1,000,000,000** cap directly.
- Remaining Property Vault capacity is calculated as `$1,000,000,000 - currently stored cash`.
- Stored Vault cash can be read from the broader Property Vault page when Torn renders it outside the immediate deposit-form subtree.
- Cayman no longer shares the Property Vault fixed-cap model and is shown as **No fixed cap**.
- If Property Vault stored cash cannot be read, SafeSell will not guess a capacity or autofill an unsafe amount.
- The capacity status card now shows the actual remaining amount when available.

## [1.0.0] — 2026-11-08

### Added
- API error classification for authorization failures, rate limits, malformed responses, timeouts, and transient failures.
- Bounded exponential API backoff and a longer cooldown for rate-limit responses.
- API suspension for invalid or insufficient credentials until the stored key is changed.
- Compact source / API / baseline / Vault-capacity status cards in the deposit-page panel.
- Collapsible diagnostics and a regression-test document.

### Changed
- Promoted the hardened DOM-first architecture to the first stable review release.
- Foreground DOM remains the primary wallet source.
- The Torn API remains optional backup infrastructure and is idle when no API key is configured.
- The final **DEPOSIT** action remains manual in this Review build.

## [0.9.7] — 2026-11-08
- Reworked SafeSell into a DOM-first architecture.
- API became optional fallback infrastructure.
- API polling and rate-bucket runtime activity remain disabled without an API key.

## [0.9.6] — 2026-11-08
- Vault autofill began using the current deposit-page wallet value.
- Manual deposit intent moved from pointerdown to an actual click and gained an expiry.
- Improved request handoff and stale-source handling.

## [0.9.5] — 2026-11-08
- Fixed stale shared wallet snapshots surviving SAFE OFF.

## [0.9.4] — 2026-11-08
- Added canonical shared wallet snapshots.
- Added last-active-tab leadership, settle verification and verified API-rate reservations.

## [0.9.3] — 2026-11-08
- First staff-review baseline.
- Navigation/autofill available; final **DEPOSIT** remains manual.

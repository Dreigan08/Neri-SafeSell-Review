# Changelog

## [1.0.1] — 2026-11-08

### Fixed
- Property Vault capacity now uses Torn's fixed **$1,000,000,000** cap directly.
- Remaining Property Vault capacity is calculated as `$1,000,000,000 - currently stored cash`.
- Stored Vault cash can be read from the broader Property Vault page when Torn renders it outside the immediate deposit-form subtree.
- Cayman no longer shares the Property Vault fixed-cap model and is shown as **No fixed cap**.
- If Property Vault stored cash cannot be read, SafeSell will not guess a capacity or autofill an unsafe amount.
- The capacity status card now shows the actual remaining amount when available.

All notable changes to the SafeSell staff-review build are documented here.

## [1.0.0] — 2026-11-08

### Added
- API error classification for authorization failures, rate limits, malformed responses, timeouts, and transient failures.
- Bounded exponential API backoff and a longer cooldown for rate-limit responses.
- API suspension for invalid or insufficient credentials until the stored key is changed.
- Explicit Property Vault capacity states: **confirmed**, **estimated**, or **unknown**.
- Compact source / API / baseline / Vault-capacity status cards in the deposit-page panel.
- Collapsible diagnostics for technical state without crowding the normal interface.
- A documented regression-test matrix in [TESTING.md](./TESTING.md).

### Changed
- Promoted the hardened DOM-first architecture to the first stable review release.
- Foreground DOM remains the primary wallet source.
- The Torn API remains optional backup infrastructure and is idle when no API key is configured.
- API failures no longer cause unsafe wallet-state updates or uncontrolled retry loops.
- The panel was cleaned up for release while preserving the existing SafeSell workflow.
- The final **DEPOSIT** action remains manual in this Review build.

## [0.9.7] — 2026-11-08

### Changed
- Reworked SafeSell into a **DOM-first** architecture.
- The DOM is authoritative while Torn is foregrounded and a usable wallet DOM source is available.
- The Torn API became an optional fallback for background monitoring or cases where a usable foreground DOM wallet source is unavailable.
- When no API key is configured, API polling, leader-election heartbeat, and API rate-bucket runtime activity remain disabled.
- Removed the previous DOM/API reconciliation state because both sources no longer compete as simultaneous wallet authorities.
- Kept Vault autofill tied to the current wallet value read from the active deposit page.

### Why
This removes unnecessary source races and keeps the normal no-API workflow as lightweight as possible.

## [0.9.6] — 2026-11-08

### Fixed
- Vault autofill now prefers the current wallet value read directly from the deposit page instead of relying only on previously cached wallet state.
- Manual deposit intent is no longer marked on `pointerdown`; it is marked only after an actual click on the deposit button.
- Deposit-intent state now expires automatically if Torn does not produce the expected wallet decrease.
- Improved stale DOM handling when API data is being used.
- API requests from an old leader are discarded after leadership changes.
- When supported by the userscript manager, an in-flight API request is aborted during leadership handoff.

### Reliability
- Reduced the chance of incorrect autofill amounts during rapid wallet changes.
- Reduced the chance of unrelated wallet decreases being mistaken for a partial deposit.

## [0.9.5] — 2026-11-08

### Fixed
- Disarming SafeSell now clears the canonical shared wallet snapshot together with the legacy scalar state.
- Prevents an old `pendingDeposit`, `lastIncrease`, or baseline state from being restored by another tab after SafeSell is re-enabled.

## [0.9.4] — 2026-11-08

### Added
- Introduced a canonical shared wallet snapshot containing wallet state, source metadata, deposit state, and wallet cycle.
- Added last-active-tab API leadership: the most recently focused Torn tab becomes the preferred API leader.
- Added a short leadership settle/verification period before API polling begins.
- Added ownership verification before API requests and API-rate reservations.
- Added request-token verification so stale leaders cannot apply old API responses.

### Fixed
- Prevented stale multi-tab state from overwriting a newer shared wallet snapshot.
- Reduced duplicate API polling caused by simultaneous leader claims.
- Improved shared API-rate coordination between tabs.

## [0.9.3] — 2026-11-08

### Review baseline
- First SafeSell build published in this repository for Torn staff review.
- Deposit navigation and autofill are available while the final **DEPOSIT** action remains manual.
- Property Vault and Cayman deposit interfaces are supported.
- Wallet increases can be detected through Torn's loaded DOM.
- Optional Torn `user/money` API monitoring is available.
- No analytics, telemetry, or third-party servers are used.
- Desktop-only runtime guards block mobile/PDA execution.
- Tampermonkey and Violentmonkey are the supported userscript managers.

---

Older internal SafeSell development builds predate this review repository and are intentionally not reconstructed here.

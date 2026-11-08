# Changelog

All notable changes to the SafeSell staff-review build are documented here.

The review repository tracks the manual-deposit build. The private one-shot build is maintained separately and is not published in this repository.

## [1.0.0] — Unreleased

Final release hardening is in progress.

Planned for the 1.0 release:
- API error classification and safe backoff behavior.
- Conservative handling of unknown Property Vault capacity.
- Regression checks for wallet detection, deduplication, multi-tab state, and source handoff.
- Small diagnostic/status improvements where useful.
- Final UI cleanup without changing the core workflow.

## [0.9.7]

### Changed
- Reworked SafeSell into a **DOM-first** architecture.
- The DOM is authoritative while Torn is foregrounded and a usable wallet DOM source is available.
- The Torn API is now an optional fallback for background monitoring or cases where a usable foreground DOM wallet source is unavailable.
- When no API key is configured, API polling, leader-election heartbeat, and API rate-bucket runtime activity remain disabled.
- Removed the previous DOM/API reconciliation state because both sources no longer compete as simultaneous wallet authorities.
- Kept Vault autofill tied to the current wallet value read from the active deposit page.

### Why
This removes unnecessary source races and keeps the normal no-API workflow as lightweight as possible.

## [0.9.6]

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

## [0.9.5]

### Fixed
- Disarming SafeSell now clears the canonical shared wallet snapshot together with the legacy scalar state.
- Prevents an old `pendingDeposit`, `lastIncrease`, or baseline state from being restored by another tab after SafeSell is re-enabled.

## [0.9.4]

### Added
- Introduced a canonical shared wallet snapshot containing wallet state, source metadata, timestamps, deposit state, and wallet cycle.
- Added last-active-tab API leadership: the most recently focused Torn tab becomes the preferred API leader.
- Added a short leadership settle/verification period before API polling begins.
- Added ownership verification before API requests and API-rate reservations.
- Added request-token verification so stale leaders cannot apply old API responses.

### Fixed
- Prevented a stale DOM value in one tab from overwriting a newer API-derived wallet value from another tab.
- Reduced duplicate API polling caused by simultaneous leader claims.
- Improved shared API-rate coordination between tabs.

## [0.9.3]

### Review baseline
- First SafeSell build published in this repository for Torn staff review.
- Automatic deposit / one-shot submission is disabled in the review build.
- Deposit navigation and autofill remain available, while the final DEPOSIT action is manual.
- Property Vault and Cayman deposit interfaces are supported.
- Wallet increases can be detected through Torn's loaded DOM.
- Optional Torn `user/money` API monitoring is available.
- No analytics, telemetry, or third-party servers are used.
- Desktop-only runtime guards block mobile/PDA execution.
- Tampermonkey and Violentmonkey are the supported userscript managers.

---

Older internal SafeSell development builds predate this review repository and are intentionally not reconstructed here.

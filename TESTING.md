# SafeSell Regression Testing

This checklist documents the main behaviors that should remain stable across releases.

## DOM-only operation
- Arm SafeSell with no API key configured.
- Confirm no API polling or rate-bucket activity starts. Shared state-owner coordination may remain active.
- Verify a wallet increase in Torn's DOM produces one alert.
- Verify $0 is accepted as a valid baseline.
- Verify SAFE OFF clears pending state and the shared snapshot.

## Vault / Cayman autofill
- Enter the Property Vault with exposed cash.
- Confirm the amount is derived from the current deposit-page DOM, not a stale cached wallet value.
- Confirm the final DEPOSIT action remains manual in this Review build.
- Verify Property Vault remaining capacity equals `$1,000,000,000 - currently stored cash`.
- If the stored amount cannot be read, verify SafeSell does not autofill a guessed amount.
- Verify Cayman is treated separately from the Property Vault fixed-cap model.

## Multi-tab coordination
- Open two or more Torn tabs with **no API key** and confirm only one tab owns wallet transitions/alerts.
- Trigger one wallet increase visible to multiple tabs and confirm only one alert is emitted.
- Regression case: simulate a scheduled/company payment while multiple Torn windows are open; confirm no repeating alarm loop occurs.
- Switch focus between tabs and confirm the most recently focused tab becomes the preferred shared-state owner.
- Open two or more Torn tabs with an API key configured.
- Confirm the most recently focused Torn tab becomes the preferred API leader.
- Confirm follower tabs do not poll the API.
- Switch focus rapidly and verify old in-flight responses cannot update wallet state after leadership is lost.
- Close the leader tab and verify another tab can take over after the lease becomes stale.

## API fallback and failures
- Start an API request, then change API key / lose leadership before the callback returns; confirm the stale callback cannot alter current API health or wallet state.
- Trigger a 429/backoff in one tab, transfer ownership to another tab, and confirm the new owner respects the same shared cooldown.
- Trigger invalid-key suspension in one tab and confirm another tab cannot immediately resume API polling with the same key revision.
- Confirm foreground DOM keeps priority over the API.
- Move Torn to the background and verify the API can act as backup when configured.
- Test invalid or insufficient API credentials: API backup should suspend rather than retry indefinitely.
- Test rate-limit or transient failures: requests should back off rather than loop.
- Test malformed or incomplete responses: wallet state must not be modified.

## Alert deduplication
- Alert once for 100k → 150k, disarm, return wallet to 100k while SafeSell is off, re-arm, then receive another 50k; confirm the second 100k → 150k transition alerts again.
- Confirm one wallet transition is not alerted twice across DOM / multi-tab synchronization.
- Confirm a wallet decrease advances the wallet cycle.
- Confirm a later legitimate increase can alert again even if it reaches a previously seen balance.
- Confirm re-arming SafeSell establishes a fresh baseline without generating an alert.

## Navigation / SPA lifecycle
- Navigate between Torn pages using normal SPA navigation.
- Confirm deposit-context cache is invalidated when routes change.
- Confirm observers reattach if Torn replaces their DOM nodes.
- Confirm the sidebar button remains aligned above Notes and never covers Torn controls.

## Runtime guards
- Desktop Tampermonkey: allowed.
- Desktop Violentmonkey: allowed.
- Android: blocked.
- iPhone: blocked.
- iPad / desktop-UA mobile context: blocked.
- Torn PDA / Flutter bridge context: blocked.
- iframe execution: blocked.
- non-Torn domains: blocked.


## Background throttling / ownership lease
- With two Torn tabs open, focus tab A and confirm A becomes the state owner immediately.
- Leave A hidden long enough for ordinary browser timer throttling; another hidden tab must not steal ownership merely because A's heartbeat is late.
- Focus tab B and confirm B takes ownership immediately without waiting for the old lease to expire.
- Let the owner timer fire late while no other tab has taken ownership; it should renew the same token rather than manufacture a false handoff.
- Simulate/observe a genuinely abandoned owner and confirm another tab can recover only after the 180-second lease.
- Freeze/resume a tab where supported and confirm API polling is stopped while frozen and state is reconciled on resume.
- Repeat the historical multi-window cash-increase scenario: one wallet transition must produce one shared alert and no alarm loop.

## UI / observer performance
- Confirm only the sidebar wallet observer, Vault observer, and one global structural observer are active.
- Generate unrelated Torn DOM churn and verify it does not repeatedly rebuild SafeSell UI.
- Confirm unchanged quick-button and SAFE-switch states do not rewrite their markup.
- Confirm identical wallet reads do not rewrite the shared snapshot more often than the intended refresh window.


## Adaptive alarm volume
- Wallet below $100,000: visual notification appears, alarm sound remains silent.
- Wallet at $100,000: alarm is audible at very low volume.
- Test intermediate exposure values such as $250k, $500k and $750k; volume should rise progressively.
- Wallet at or above $1,000,000: alarm uses the original full volume.
- The Test alarm button remains full-volume regardless of the current wallet.

## Deposit-page render latency
- Navigate into Property Vault and Cayman from another Torn page.
- If the DEPOSIT button/input already exists, SafeSell should acquire the form through the fast path without waiting for the expensive text scan.
- During Torn's initial rendering window, the waiting panel should re-check approximately every 80 ms.
- After 2.5 seconds of unresolved rendering, checks may slow to approximately 250 ms.
- Confirm the transient probe stops once the deposit context is found or after leaving the deposit route.

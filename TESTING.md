# SafeSell Regression Testing

This checklist documents the main behaviors that should remain stable across releases.

## DOM-only operation
- Arm SafeSell with no API key configured.
- Confirm no API polling, leader heartbeat, or rate-bucket activity starts.
- Verify a wallet increase in Torn's DOM produces one alert.
- Verify $0 is accepted as a valid baseline.
- Verify SAFE OFF clears pending state and the shared snapshot.

## Vault / Cayman autofill
- Enter the Property Vault with exposed cash.
- Confirm the amount is derived from the current deposit-page DOM, not a stale cached wallet value.
- Confirm the final DEPOSIT action remains manual in this Review build.
- Verify confirmed / estimated / unknown capacity states are reported safely.
- Repeat on Cayman where applicable.

## Multi-tab coordination
- Open two or more Torn tabs with an API key configured.
- Confirm the most recently focused Torn tab becomes the preferred API leader.
- Confirm follower tabs do not poll the API.
- Switch focus rapidly and verify old in-flight responses cannot update wallet state after leadership is lost.
- Close the leader tab and verify another tab can take over after the lease becomes stale.

## API fallback and failures
- Confirm foreground DOM keeps priority over the API.
- Move Torn to the background and verify the API can act as backup when configured.
- Test invalid or insufficient API credentials: API backup should suspend rather than retry indefinitely.
- Test rate-limit or transient failures: requests should back off rather than loop.
- Test malformed or incomplete responses: wallet state must not be modified.

## Alert deduplication
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

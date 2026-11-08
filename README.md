# Neri SafeSell — Staff Review

This repository contains the **SafeSell userscript source submitted for Torn staff review**.

## Current build

**Neri SafeSell v1.0.6 — Review**

Source: [NeriSafeSell_v1.0.6_Review.user.js](./NeriSafeSell_v1.0.6_Review.user.js)

SHA-256 of the current reviewed source:

`46ec59bd73e02ab78624b4d1e5de51bfeee549a6ff2342e8ae59e678ffc89875`

## What SafeSell does

SafeSell is a desktop userscript intended to reduce the time a player keeps cash exposed after receiving money.

It:

- monitors wallet changes through Torn's loaded web interface (DOM);
- can optionally use Torn's official `user/money` API as a backup source;
- treats foreground DOM data as the primary wallet source;
- keeps API runtime idle when no API key is configured;
- shows an alarm / browser notification when wallet cash increases;
- provides a shortcut to the Property Vault;
- can autofill the deposit field from the current deposit-page wallet value;
- supports Property Vault and Cayman deposit interfaces;
- coordinates a single shared-state owner across tabs, with optional API polling on that same owner;
- applies API rate guarding, shared cross-tab API health, and bounded backoff on failures.

The final **DEPOSIT** action remains manual in this Review build.

## Security / privacy

- No analytics or telemetry.
- No third-party servers.
- Network requests are limited to `api.torn.com`.
- The intended API permission is `user/money` only.
- API keys are stored locally through the userscript manager's GM storage.
- Mobile browsers and Torn PDA are blocked before initialization.
- Supported desktop userscript managers are Tampermonkey and Violentmonkey.

## Project history and testing

- [CHANGELOG.md](./CHANGELOG.md) — changes from the 0.9.x review builds through 1.0.0.
- [TESTING.md](./TESTING.md) — regression checklist for DOM monitoring, multi-tab behavior, API fallback, alerts, navigation, and runtime guards.

## Review note

This repository exists so Torn staff can inspect the exact source corresponding to the hash above. Code changes are published as new versions rather than silently replacing a reviewed build.

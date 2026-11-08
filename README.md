# Neri SafeSell — Staff Review

This repository contains the **SafeSell userscript source submitted for Torn staff review**.

## Build

**Neri SafeSell v0.9.6 — Experimental Review**

Source: [NeriSafeSell_v0.9.6_Experimental_Review.user.js](./NeriSafeSell_v0.9.6_Experimental_Review.user.js)

SHA-256 of the reviewed source:

`750137983076980eb125ad2cb6f702b297e6aed6ee3398e65497c07967bb9061`

## What SafeSell does

SafeSell is a desktop userscript intended to reduce the time a player keeps cash exposed after receiving money.

It:

- monitors wallet changes through Torn's loaded web interface (DOM);
- can also use Torn's official `user/money` API as a backup source;
- shows an alarm / browser notification when wallet cash increases;
- provides a shortcut to the Property Vault;
- can autofill the Vault deposit field with the available wallet amount;
- supports Property Vault and Cayman deposit interfaces;
- coordinates API polling between multiple tabs and includes its own API rate guard.

## Security / privacy

- No analytics or telemetry.
- No third-party servers.
- Network requests are limited to `api.torn.com`.
- The intended API permission is `user/money` only.
- API keys are stored locally through the userscript manager's GM storage.
- Mobile browsers and Torn PDA are blocked before initialization.
- Supported desktop userscript managers are Tampermonkey and Violentmonkey.

## Review note

This repository exists so Torn staff can inspect the exact source corresponding to the hash above. If code changes are requested, they will be published as a new version rather than silently replacing the reviewed build.

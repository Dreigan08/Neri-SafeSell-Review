# Neri SafeSell — Staff Review

This repository contains the **unobfuscated SafeSell userscript source submitted for Torn staff review**.

## Build

**Neri SafeSell v0.9.3 — Experimental Review**

Source: [NeriSafeSell_v0.9.3_Experimental_Review.user.js](./NeriSafeSell_v0.9.3_Experimental_Review.user.js)

SHA-256 of the reviewed source:

`0efd4b219350859ea42b01c65293fad272ffebdcdf3df37226480ead7ce9196d`

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

The actual deposit action remains manual.

## Review question

The behavior I would like clarification on is **DOM monitoring while Torn remains loaded but is not the actively focused tab/window**.

In that state, SafeSell's DOM observers can continue detecting wallet changes from Torn's already-loaded interface. The official Torn API may also continue polling independently.

This DOM monitoring does not itself submit game actions or generate additional non-API requests.

My question is:

> Is observing changes in the DOM of an already-loaded Torn page while that page is in the background acceptable under Torn's scripting rules, when the observations are used only for wallet monitoring/alerts and do not submit game actions or generate additional non-API requests?

## Security / privacy

- No analytics or telemetry.
- No third-party servers.
- Network requests are limited to `api.torn.com`.
- The intended API permission is `user/money` only.
- API keys are stored locally through the userscript manager's GM storage.
- Source is intentionally unobfuscated.
- Mobile browsers and Torn PDA are blocked before initialization.
- Supported desktop userscript managers are Tampermonkey and Violentmonkey.

## Review note

This repository exists so Torn staff can inspect the exact source corresponding to the hash above. If code changes are requested, they will be published as a new version rather than silently replacing the reviewed build.

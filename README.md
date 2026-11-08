# Neri SafeSell — Experimental Review

This repository contains an **unobfuscated SafeSell userscript build submitted for Torn staff review**.

## Build

**Neri SafeSell v0.9.3 — Experimental Review**

Source: [NeriSafeSell_v0.9.3_Experimental_Review.user.js](./NeriSafeSell_v0.9.3_Experimental_Review.user.js)

SHA-256 of the reviewed source:

`0efd4b219350859ea42b01c65293fad272ffebdcdf3df37226480ead7ce9196d`

## What SafeSell does

SafeSell is a desktop userscript intended to reduce the time a player keeps cash exposed after receiving money.

This review build:

- monitors wallet changes through Torn's loaded web interface (DOM);
- can also use Torn's official `user/money` API as a backup source;
- shows an alarm / browser notification when wallet cash increases;
- provides a shortcut to the Property Vault;
- can autofill the Vault deposit field with the available wallet amount;
- supports Property Vault and Cayman deposit interfaces;
- coordinates API polling between multiple tabs and includes its own API rate guard.

## Important: deposit remains manual

**This review build does not automatically submit a deposit.**

There is no one-shot deposit behavior in this version. SafeSell may navigate to the Property Vault and autofill the amount, but the player must manually click **DEPOSIT**.

The build contains no synthetic deposit click, `submit()`, `requestSubmit()`, or one-shot `sessionStorage` flow.

## Behavior submitted for clarification

The specific behavior I would like staff to review is **background DOM monitoring**.

In this Experimental Review build, if Torn remains loaded but the tab/window is not actively focused, SafeSell's DOM observers remain active and may detect wallet changes from Torn's already-loaded interface. The official Torn API can also continue polling independently.

No game action is performed automatically as a result of those observations.

My main question is:

> Is observing changes in an already-loaded Torn page's DOM while the page is in the background acceptable under the scripting rules, provided the script does not submit actions or generate additional non-API requests from that DOM monitoring?

If that behavior is not permitted, SafeSell already has a more conservative public design where DOM monitoring stops outside the active/focused Torn page and background monitoring is API-only.

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

This repository exists specifically so Torn staff can inspect the exact source corresponding to the hash above. If code changes are requested, they will be published as a new version rather than silently replacing the reviewed build.

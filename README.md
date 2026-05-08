# Asset Hunter

Tampermonkey userscript for searching Ripper.Store for Booth/Gumroad/Jinxxy/Payhip assets.

## Install

- Install URL: `https://raw.githubusercontent.com/xedinho/Asset-Hunter/main/Asset%20Hunter-5.5.0.user.js`

## Auto-update

Auto-update is enabled via metadata:

- `@updateURL`: `https://raw.githubusercontent.com/xedinho/Asset-Hunter/main/Asset%20Hunter.meta.js`
- `@downloadURL`: `https://raw.githubusercontent.com/xedinho/Asset-Hunter/main/Asset%20Hunter-5.5.0.user.js`

## Release flow

1. Bump `@version` in:
   - `Asset Hunter-5.5.0.user.js`
   - `Asset Hunter.meta.js`
2. Commit and push to `main`.
3. Tampermonkey users receive update automatically.

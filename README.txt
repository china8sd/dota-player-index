Dota Player Index V4.21 — Modular build

Base: V4.21 role compare fix.
Architecture only: CSS and JS extracted from the original index.html.
No analytics logic, OpenDota logic, role logic, compare logic, assets, or visual design intentionally changed.

Files:
- index.html — page structure
- css/style.css — original embedded CSS
- js/app.js — original embedded JavaScript
- assets/ — original assets

Shareable player links:
- Open https://china8sd.github.io/dota-player-index/{steamID} to start analysis automatically.
- Both numeric OpenDota account IDs and SteamID64 are supported, with an optional trailing slash.
- After a successful analysis, copy the browser address to share the player with friends.
- GitHub Pages uses 404.html to redirect player paths to the app; keep this file when deploying.
- For local hosting, serve the project at /dota-player-index/ and use 404.html as the fallback.
- Run the routing checks with: node tests/player-links.test.cjs

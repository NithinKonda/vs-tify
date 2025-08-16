
# Personal Spotify VS Code Extension

Bring your Spotify library right into VS Code.
Control playback, browse playlists, and search tracks without leaving your editor.

## ✨ Features

| Feature | Description |
| :-- | :-- |
| 🎛 **Status-bar control** | A compact Spotify icon in the status bar opens the full panel and queue. |
| 🎵 **Now Playing** | Shows the current (or most recent) track with artist names and live refresh. |
| 🔍 **Quick Search** | Search tracks by name and play any result instantly. |
| 📑 **Playlists Browser** | Lists all your playlists. View tracks inside any playlist or start it with one click. |
| ▶️ **Playback controls** | Play/pause, skip, play individual tracks, or play entire playlists. |
| ♻️ **Auto-refresh tokens** | Uses your refresh token to keep the session alive indefinitely—no manual renewals. |

*(Add screenshots or GIFs in an `images/` folder and reference them here, e.g. `*

## 📦 Requirements

1. **Spotify Premium account** – the Web API can only control playback on Premium.
2. **A Spotify Developer app** – create one at [https://developer.spotify.com/dashboard](https://developer.spotify.com/dashboard).
3. **Access \& Refresh tokens** – follow the steps below once; the extension refreshes automatically afterwards.

### Obtaining tokens (one-time)

1. In the Spotify Dashboard, add a redirect URI:
`http://127.0.0.1:3000/callback`
2. Copy your **Client ID** and **Client Secret**.
3. Generate an authorization code for the scopes:
`user-read-playback-state user-read-currently-playing user-read-recently-played playlist-read-private user-modify-playback-state user-read-playback-position`
4. Exchange the code for **access** and **refresh** tokens with a `POST https://accounts.spotify.com/api/token` request.
5. Paste the tokens (and your client credentials) into `extension.ts` before packaging.

*(For detailed, copy-paste curl snippets see the project wiki.)*

## ⚙️ Extension Settings

| Setting | Description | Default |
| :-- | :-- | :-- |
| `spotifyPersonal.showStatusBarIcon` | Hide or show the status-bar icon. | `true` |
| `spotifyPersonal.pollInterval` | Seconds between automatic “Now Playing” refreshes. | `30` |
| `spotifyPersonal.deviceName` | Preferred device name to control (leave blank for active device). | `""` |

## 🐞 Known Issues

- Playlist tracks are limited to the first 50 items (Spotify API paging).
- Playback commands fail if no active device is available—start Spotify on any device first.
- The extension currently uses hard-coded client credentials; moving them to VS Code Secret Storage is planned.


## 📜 Release Notes

### 1.0.0

* Initial release.
* Status-bar launcher, full webview panel.
* Search tracks, browse playlists, play tracks \& playlists.
* Automatic token refresh with persistent storage.


## 🚀 Development \& Packaging

```bash
# install deps
npm install

# compile & lint
npm run compile

# package as VSIX (requires Node 20+ or vsce ≤ 2.22)
vsce package
```

Install the generated `.vsix` via **Extensions ▶ … ▶ Install from VSIX** or
`code --install-extension spotify-personal-1.0.0.vsix`.

## 💡 Contributing

Pull requests and issues are welcome—this is a personal project but improvement ideas are always appreciated!

Enjoy seamless Spotify control without leaving your code ✌️


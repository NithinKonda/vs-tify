import * as vscode from 'vscode';
import SpotifyWebApi from 'spotify-web-api-node';

// Your Spotify app credentials
let INITIAL_ACCESS_TOKEN = ""

const CLIENT_ID = ""
const CLIENT_SECRET = ""

// Initial tokens from your response
const REFRESH_TOKEN = '';

let ACCESS_TOKEN: string;
let tokenExpiresAt: number;
let context: vscode.ExtensionContext;

const spotifyApi = new SpotifyWebApi();

export async function activate(extensionContext: vscode.ExtensionContext) {
    context = extensionContext;

    // Load stored token data or use initial values
    await initializeTokens();

    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.text = '$(play-circle) Spotify';
    statusBarItem.command = 'spotify-personal.openSpotifyPanel';
    statusBarItem.tooltip = 'Open Spotify Panel';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    context.subscriptions.push(
        vscode.commands.registerCommand('spotify-personal.openSpotifyPanel', async () => {
            await ensureValidToken();

            const panel = vscode.window.createWebviewPanel(
                'spotifyPanel',
                'Spotify',
                vscode.ViewColumn.One,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true
                }
            );

            panel.webview.html = await getWebviewContent();

            panel.webview.onDidReceiveMessage(
                async message => {
                    await ensureValidToken();

                    switch (message.command) {
                        case 'playPause':
                            await playPause();
                            panel.webview.postMessage({
                                command: 'updateCurrentTrack',
                                track: await getCurrentPlaying()
                            });
                            return;
                        case 'skip':
                            await skipTrack();
                            setTimeout(async () => {
                                panel.webview.postMessage({
                                    command: 'updateCurrentTrack',
                                    track: await getCurrentPlaying()
                                });
                            }, 1000);
                            return;
                        case 'search':
                            const results = await searchSongs(message.query);
                            panel.webview.postMessage({
                                command: 'searchResults',
                                results
                            });
                            return;
                        case 'playTrack':
                            await playTrack(message.trackUri);
                            setTimeout(async () => {
                                panel.webview.postMessage({
                                    command: 'updateCurrentTrack',
                                    track: await getCurrentPlaying()
                                });
                            }, 1000);
                            return;
                        case 'openPlaylist':
                            const playlistTracks = await getPlaylistTracks(message.playlistId);
                            panel.webview.postMessage({
                                command: 'showPlaylistTracks',
                                tracks: playlistTracks,
                                playlistName: message.playlistName
                            });
                            return;
                        case 'playPlaylist':
                            await playPlaylist(message.playlistUri);
                            setTimeout(async () => {
                                panel.webview.postMessage({
                                    command: 'updateCurrentTrack',
                                    track: await getCurrentPlaying()
                                });
                            }, 1000);
                            return;
                        case 'refresh':
                            panel.webview.postMessage({
                                command: 'updateCurrentTrack',
                                track: await getCurrentPlaying()
                            });
                            return;
                    }
                },
                undefined,
                context.subscriptions
            );
        })
    );
}

export function deactivate() { }

// NEW: Initialize tokens from storage or use defaults
async function initializeTokens(): Promise<void> {
    // Try to load stored values
    ACCESS_TOKEN = context.globalState.get('spotifyAccessToken', INITIAL_ACCESS_TOKEN);
    tokenExpiresAt = context.globalState.get('spotifyTokenExpiresAt', 0);

    // If no stored expiration time or it's already expired, assume token is expired
    if (tokenExpiresAt === 0 || Date.now() >= tokenExpiresAt) {
        console.log('Token expired or not found, will refresh on first use');
        tokenExpiresAt = 0; // Force refresh on first API call
    }

    spotifyApi.setAccessToken(ACCESS_TOKEN);
}

// UPDATED: Store token data persistently
async function storeTokenData(accessToken: string, expiresIn: number): Promise<void> {
    ACCESS_TOKEN = accessToken;
    tokenExpiresAt = Date.now() + ((expiresIn - 300) * 1000); // 5 minutes buffer

    // Store in VS Code's persistent storage
    await context.globalState.update('spotifyAccessToken', ACCESS_TOKEN);
    await context.globalState.update('spotifyTokenExpiresAt', tokenExpiresAt);

    spotifyApi.setAccessToken(ACCESS_TOKEN);
}

// UPDATED: Better token validation
async function ensureValidToken(): Promise<void> {
    // Check if token is expired or will expire in the next 5 minutes
    if (Date.now() >= (tokenExpiresAt - 5 * 60 * 1000)) {
        console.log('Token expired or expiring soon, refreshing...');
        await refreshAccessToken();
    }
}

// UPDATED: Store new token data when refreshing
async function refreshAccessToken(): Promise<void> {
    try {
        const response = await fetch('https://accounts.spotify.com/api/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')
            },
            body: new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: REFRESH_TOKEN
            })
        });

        if (!response.ok) {
            throw new Error(`Token refresh failed: ${response.statusText}`);
        }

        const data = await response.json();

        // Store the new token with proper expiration time
        await storeTokenData(data.access_token, data.expires_in);

        console.log('Spotify access token refreshed successfully');

    } catch (error) {
        console.error('Error refreshing token:', error);
        vscode.window.showErrorMessage('Failed to refresh Spotify token. Extension may not work properly.');
    }
}

// All other functions remain the same...
async function playTrack(trackUri: string): Promise<void> {
    try {
        await ensureValidToken();
        await spotifyApi.play({
            uris: [trackUri]
        });
        vscode.window.showInformationMessage('Playing track!');
    } catch (error) {
        console.error('Error playing track:', error);
        vscode.window.showErrorMessage('Error playing track. Make sure Spotify is active on a device.');
    }
}

async function playPlaylist(playlistUri: string): Promise<void> {
    try {
        await ensureValidToken();
        await spotifyApi.play({
            context_uri: playlistUri
        });
        vscode.window.showInformationMessage('Playing playlist!');
    } catch (error) {
        console.error('Error playing playlist:', error);
        vscode.window.showErrorMessage('Error playing playlist. Make sure Spotify is active on a device.');
    }
}

async function getPlaylistTracks(playlistId: string): Promise<Array<{ name: string, artist: string, uri: string }>> {
    try {
        await ensureValidToken();
        const data = await spotifyApi.getPlaylistTracks(playlistId, { limit: 50 });
        return data.body.items
            .filter(item => item.track && item.track.type === 'track')
            .map(item => ({
                name: item.track!.name,
                artist: item.track!.artists.map(artist => artist.name).join(', '),
                uri: item.track!.uri
            }));
    } catch (error) {
        console.error('Error fetching playlist tracks:', error);
        return [];
    }
}

async function searchSongs(query: string): Promise<Array<{ name: string, artist: string, id: string, uri: string }>> {
    try {
        await ensureValidToken();
        const data = await spotifyApi.searchTracks(query, { limit: 10 });
        if (data.body.tracks && data.body.tracks.items) {
            return data.body.tracks.items.map(item => ({
                name: item.name,
                artist: item.artists.map(artist => artist.name).join(', '),
                id: item.id,
                uri: item.uri
            }));
        }
        return [];
    } catch (error) {
        console.error('Error searching songs:', error);
        return [];
    }
}

async function getPlaylists(): Promise<Array<{ name: string, id: string, uri: string }>> {
    try {
        await ensureValidToken();
        const data = await spotifyApi.getUserPlaylists();
        return data.body.items.map(playlist => ({
            name: playlist.name,
            id: playlist.id,
            uri: playlist.uri
        }));
    } catch (error) {
        console.error('Error fetching playlists:', error);
        return [];
    }
}

async function getCurrentPlaying(): Promise<string> {
    try {
        await ensureValidToken();
        const data = await spotifyApi.getMyCurrentPlayingTrack();
        if (data.body && data.body.item) {
            const track = data.body.item;
            const artists = track.artists.map(artist => artist.name).join(', ');
            return `${track.name} - ${artists}`;
        }
        return await getRecentPlayed();
    } catch (error) {
        console.error('Error fetching current track:', error);
        return 'Error fetching current track';
    }
}

async function getRecentPlayed(): Promise<string> {
    try {
        await ensureValidToken();
        const data = await spotifyApi.getMyRecentlyPlayedTracks({ limit: 1 });
        if (data.body.items && data.body.items.length > 0) {
            const track = data.body.items[0].track;
            const artists = track.artists.map(artist => artist.name).join(', ');
            return `${track.name} - ${artists} (Recent)`;
        }
        return 'No recent tracks found';
    } catch (error) {
        console.error('Error fetching recent tracks:', error);
        return 'Error fetching recent tracks';
    }
}

async function playPause(): Promise<void> {
    try {
        await ensureValidToken();
        const playback = await spotifyApi.getMyCurrentPlaybackState();
        if (playback.body && playback.body.is_playing) {
            await spotifyApi.pause();
        } else {
            await spotifyApi.play();
        }
    } catch (error) {
        console.error('Playback control error:', error);
        vscode.window.showErrorMessage('Error controlling playback. Make sure Spotify is active on a device.');
    }
}

async function skipTrack(): Promise<void> {
    try {
        await ensureValidToken();
        await spotifyApi.skipToNext();
    } catch (error) {
        console.error('Skip error:', error);
        vscode.window.showErrorMessage('Error skipping track. Make sure Spotify is active on a device.');
    }
}

// HTML content remains the same as in the previous version...
async function getWebviewContent(): Promise<string> {
    const currentTrack = await getCurrentPlaying();
    const playlists = await getPlaylists();

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Spotify Panel</title>
        <style>
            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                padding: 20px;
                background-color: var(--vscode-editor-background);
                color: var(--vscode-editor-foreground);
            }
            .section {
                margin-bottom: 30px;
                padding: 15px;
                border: 1px solid var(--vscode-panel-border);
                border-radius: 6px;
                background-color: var(--vscode-panel-background);
            }
            .current-track {
                font-size: 16px;
                font-weight: bold;
                margin-bottom: 10px;
                color: var(--vscode-textLink-foreground);
            }
            input[type="text"] {
                width: 70%;
                padding: 8px;
                margin-right: 10px;
                background-color: var(--vscode-input-background);
                color: var(--vscode-input-foreground);
                border: 1px solid var(--vscode-input-border);
                border-radius: 3px;
            }
            button {
                padding: 8px 16px;
                background-color: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
                border: none;
                border-radius: 3px;
                cursor: pointer;
                margin: 2px;
            }
            button:hover {
                background-color: var(--vscode-button-hoverBackground);
            }
            .small-btn {
                padding: 4px 8px;
                font-size: 12px;
                margin-left: 10px;
            }
            .control-buttons {
                display: flex;
                gap: 10px;
                margin-top: 10px;
            }
            ul {
                list-style-type: none;
                padding: 0;
            }
            li {
                padding: 8px;
                margin: 4px 0;
                background-color: var(--vscode-list-inactiveSelectionBackground);
                border-radius: 3px;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            .clickable {
                cursor: pointer;
                transition: background-color 0.2s;
            }
            .clickable:hover {
                background-color: var(--vscode-list-hoverBackground);
            }
            h2, h3 {
                color: var(--vscode-titleBar-activeForeground);
                margin-top: 0;
            }
            .refresh-btn {
                float: right;
                font-size: 12px;
                padding: 4px 8px;
            }
            .track-info {
                flex-grow: 1;
            }
            .track-buttons {
                display: flex;
                gap: 5px;
            }
            #playlistTracks {
                display: none;
            }
        </style>
    </head>
    <body>
        <div class="section">
            <h2>Now Playing 
                <button class="refresh-btn" onclick="refreshCurrentTrack()">🔄 Refresh</button>
            </h2>
            <div id="currentTrack" class="current-track">${currentTrack}</div>
            <div class="control-buttons">
                <button onclick="sendMessage('playPause')">⏯️ Play/Pause</button>
                <button onclick="sendMessage('skip')">⏭️ Skip</button>
            </div>
        </div>

        <div class="section">
            <h3>Search Songs</h3>
            <input id="searchInput" type="text" placeholder="Search for songs..." onkeypress="handleSearchKeyPress(event)">
            <button onclick="searchSongs()">🔍 Search</button>
            <ul id="searchResults"></ul>
        </div>

        <div class="section">
            <h3>Your Playlists</h3>
            <ul id="playlistsList">
                ${playlists.map(playlist => `
                    <li class="clickable">
                        <span class="track-info">🎵 ${playlist.name}</span>
                        <div class="track-buttons">
                            <button class="small-btn" onclick="openPlaylist('${playlist.id}', '${playlist.name}')">View</button>
                            <button class="small-btn" onclick="playPlaylist('${playlist.uri}')">▶️ Play</button>
                        </div>
                    </li>
                `).join('')}
            </ul>
        </div>

        <div class="section" id="playlistTracks">
            <h3 id="playlistTitle">Playlist Tracks</h3>
            <button onclick="closePlaylistView()" style="float: right;">❌ Close</button>
            <ul id="playlistTracksList"></ul>
        </div>

        <script>
            const vscode = acquireVsCodeApi();
            
            function sendMessage(command, data = {}) {
                vscode.postMessage({ command, ...data });
            }
            
            function searchSongs() {
                const query = document.getElementById('searchInput').value.trim();
                if (query) {
                    vscode.postMessage({ command: 'search', query });
                }
            }
            
            function handleSearchKeyPress(event) {
                if (event.key === 'Enter') {
                    searchSongs();
                }
            }
            
            function refreshCurrentTrack() {
                vscode.postMessage({ command: 'refresh' });
            }
            
            function playTrack(trackUri) {
                vscode.postMessage({ command: 'playTrack', trackUri });
            }
            
            function openPlaylist(playlistId, playlistName) {
                vscode.postMessage({ command: 'openPlaylist', playlistId, playlistName });
            }
            
            function playPlaylist(playlistUri) {
                vscode.postMessage({ command: 'playPlaylist', playlistUri });
            }
            
            function closePlaylistView() {
                document.getElementById('playlistTracks').style.display = 'none';
            }
            
            window.addEventListener('message', event => {
                const message = event.data;
                switch (message.command) {
                    case 'searchResults':
                        const searchResultsList = document.getElementById('searchResults');
                        if (message.results.length === 0) {
                            searchResultsList.innerHTML = '<li>No results found</li>';
                        } else {
                            searchResultsList.innerHTML = message.results
                                .map(result => \`
                                    <li class="clickable">
                                        <span class="track-info">🎵 \${result.name} - \${result.artist}</span>
                                        <button class="small-btn" onclick="playTrack('\${result.uri}')">▶️ Play</button>
                                    </li>
                                \`).join('');
                        }
                        break;
                    case 'updateCurrentTrack':
                        document.getElementById('currentTrack').textContent = message.track;
                        break;
                    case 'showPlaylistTracks':
                        document.getElementById('playlistTitle').textContent = message.playlistName + ' - Tracks';
                        const playlistTracksList = document.getElementById('playlistTracksList');
                        if (message.tracks.length === 0) {
                            playlistTracksList.innerHTML = '<li>No tracks found</li>';
                        } else {
                            playlistTracksList.innerHTML = message.tracks
                                .map(track => \`
                                    <li class="clickable">
                                        <span class="track-info">🎵 \${track.name} - \${track.artist}</span>
                                        <button class="small-btn" onclick="playTrack('\${track.uri}')">▶️ Play</button>
                                    </li>
                                \`).join('');
                        }
                        document.getElementById('playlistTracks').style.display = 'block';
                        break;
                }
            });
        </script>
    </body>
    </html>`;
}
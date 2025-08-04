import * as vscode from 'vscode';
import SpotifyWebApi from 'spotify-web-api-node';

// Replace with your actual Spotify access token
const SPOTIFY_ACCESS_TOKEN = 'YOUR_SPOTIFY_ACCESS_TOKEN_HERE';

const spotifyApi = new SpotifyWebApi();
spotifyApi.setAccessToken(SPOTIFY_ACCESS_TOKEN);

export function activate(context: vscode.ExtensionContext) {
    // Create status bar item
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.text = '$(play-circle) Spotify';
    statusBarItem.command = 'spotify-personal.openSpotifyPanel';
    statusBarItem.tooltip = 'Open Spotify Panel';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    // Register command to open webview
    context.subscriptions.push(
        vscode.commands.registerCommand('spotify-personal.openSpotifyPanel', async () => {
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

            // Handle messages from webview
            panel.webview.onDidReceiveMessage(
                async message => {
                    switch (message.command) {
                        case 'playPause':
                            await playPause();
                            // Refresh the current track display
                            panel.webview.postMessage({ 
                                command: 'updateCurrentTrack', 
                                track: await getCurrentPlaying() 
                            });
                            return;
                        case 'skip':
                            await skipTrack();
                            // Refresh the current track display after skip
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

export function deactivate() {}

// Spotify API Functions
async function getCurrentPlaying(): Promise<string> {
    try {
        const data = await spotifyApi.getMyCurrentPlayingTrack();
        if (data.body && data.body.item) {
            const track = data.body.item;
            const artists = track.artists.map(artist => artist.name).join(', ');
            return `${track.name} - ${artists}`;
        }
        // If nothing is currently playing, get the most recent track
        return await getRecentPlayed();
    } catch (error) {
        console.error('Error fetching current track:', error);
        return 'Error fetching current track';
    }
}

async function getRecentPlayed(): Promise<string> {
    try {
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

async function searchSongs(query: string): Promise<Array<{name: string, artist: string, id: string}>> {
    try {
        const data = await spotifyApi.searchTracks(query, { limit: 10 });
        if (data.body.tracks && data.body.tracks.items) {
            return data.body.tracks.items.map(item => ({
                name: item.name,
                artist: item.artists.map(artist => artist.name).join(', '),
                id: item.id
            }));
        }
        return [];
    } catch (error) {
        console.error('Error searching songs:', error);
        return [];
    }
}

async function getPlaylists(): Promise<Array<{name: string, id: string}>> {
    try {
        const data = await spotifyApi.getUserPlaylists();
        return data.body.items.map(playlist => ({
            name: playlist.name,
            id: playlist.id
        }));
    } catch (error) {
        console.error('Error fetching playlists:', error);
        return [];
    }
}

async function playPause(): Promise<void> {
    try {
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
        await spotifyApi.skipToNext();
    } catch (error) {
        console.error('Skip error:', error);
        vscode.window.showErrorMessage('Error skipping track. Make sure Spotify is active on a device.');
    }
}

// Generate webview HTML content
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
            }
            .search-result {
                cursor: pointer;
                transition: background-color 0.2s;
            }
            .search-result:hover {
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
            <ul>
                ${playlists.map(playlist => `<li>🎵 ${playlist.name}</li>`).join('')}
            </ul>
        </div>

        <script>
            const vscode = acquireVsCodeApi();
            
            function sendMessage(command) {
                vscode.postMessage({ command });
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
            
            // Listen for messages from extension
            window.addEventListener('message', event => {
                const message = event.data;
                switch (message.command) {
                    case 'searchResults':
                        const searchResultsList = document.getElementById('searchResults');
                        if (message.results.length === 0) {
                            searchResultsList.innerHTML = '<li>No results found</li>';
                        } else {
                            searchResultsList.innerHTML = message.results
                                .map(result => 
                                    \`<li class="search-result">🎵 \${result.name} - \${result.artist}</li>\`
                                ).join('');
                        }
                        break;
                    case 'updateCurrentTrack':
                        document.getElementById('currentTrack').textContent = message.track;
                        break;
                }
            });
        </script>
    </body>
    </html>`;
}

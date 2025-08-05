import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
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

            panel.webview.html = await getWebviewContent(context);

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
async function getWebviewContent(context: vscode.ExtensionContext): Promise<string> {
    const currentTrack = await getCurrentPlaying();
    const playlists = await getPlaylists();

    const htmlPath = path.join(context.extensionPath, 'src', 'media', 'panel.html');
    let html = fs.readFileSync(htmlPath, 'utf8');

    const renderedPlaylists = playlists.map(playlist => `
        <li class="clickable">
            <span class="track-info">🎵 ${playlist.name}</span>
            <div class="track-buttons">
                <button class="small-btn" onclick="openPlaylist('${playlist.id}', '${playlist.name}')">View</button>
                <button class="small-btn" onclick="playPlaylist('${playlist.uri}')">▶️ Play</button>
            </div>
        </li>
    `).join('');

    html = html
        .replace('<!-- PLAYLIST_ITEMS -->', renderedPlaylists)
        .replace('${currentTrack}', currentTrack || 'Nothing playing');

    return html;
}

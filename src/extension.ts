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

// Queue management
let customQueue: Array<{ name: string, artist: string, uri: string, id: string }> = [];
let currentQueueIndex = 0;
let isAutoplayEnabled = true;
let playbackMonitorInterval: NodeJS.Timeout | undefined;

const spotifyApi = new SpotifyWebApi();

export async function activate(extensionContext: vscode.ExtensionContext) {
    context = extensionContext;

    // Load stored token data or use initial values
    await initializeTokens();
    
    // Load saved settings
    await loadSettings();

    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.text = '$(play-circle) Spotify';
    statusBarItem.command = 'spotify-personal.openSpotifyPanel';
    statusBarItem.tooltip = 'Open Spotify Panel';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    // Start playback monitoring for autoplay
    startPlaybackMonitoring();

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
                                track: await getCurrentPlaying(),
                                playbackState: await getPlaybackState()
                            });
                            return;
                        case 'skip':
                            await skipTrack();
                            setTimeout(async () => {
                                panel.webview.postMessage({
                                    command: 'updateCurrentTrack',
                                    track: await getCurrentPlaying(),
                                    playbackState: await getPlaybackState()
                                });
                            }, 1000);
                            return;
                        case 'previous':
                            await previousTrack();
                            setTimeout(async () => {
                                panel.webview.postMessage({
                                    command: 'updateCurrentTrack',
                                    track: await getCurrentPlaying(),
                                    playbackState: await getPlaybackState()
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
                                    track: await getCurrentPlaying(),
                                    playbackState: await getPlaybackState()
                                });
                            }, 1000);
                            return;
                        case 'addToQueue':
                            await addToQueue(message.track);
                            panel.webview.postMessage({
                                command: 'updateQueue',
                                queue: customQueue,
                                currentIndex: currentQueueIndex
                            });
                            vscode.window.showInformationMessage(`Added "${message.track.name}" to queue`);
                            return;
                        case 'removeFromQueue':
                            removeFromQueue(message.index);
                            panel.webview.postMessage({
                                command: 'updateQueue',
                                queue: customQueue,
                                currentIndex: currentQueueIndex
                            });
                            return;
                        case 'playFromQueue':
                            await playFromQueue(message.index);
                            panel.webview.postMessage({
                                command: 'updateCurrentTrack',
                                track: await getCurrentPlaying(),
                                playbackState: await getPlaybackState(),
                                queue: customQueue,
                                currentIndex: currentQueueIndex
                            });
                            return;
                        case 'clearQueue':
                            clearQueue();
                            panel.webview.postMessage({
                                command: 'updateQueue',
                                queue: customQueue,
                                currentIndex: currentQueueIndex
                            });
                            return;
                        case 'toggleAutoplay':
                            isAutoplayEnabled = !isAutoplayEnabled;
                            await saveSettings();
                            panel.webview.postMessage({
                                command: 'updateAutoplayStatus',
                                enabled: isAutoplayEnabled
                            });
                            vscode.window.showInformationMessage(`Autoplay ${isAutoplayEnabled ? 'enabled' : 'disabled'}`);
                            return;
                        case 'setVolume':
                            await setVolume(message.volume);
                            return;
                        case 'toggleShuffle':
                            await toggleShuffle();
                            panel.webview.postMessage({
                                command: 'updatePlaybackState',
                                playbackState: await getPlaybackState()
                            });
                            return;
                        case 'toggleRepeat':
                            await toggleRepeat();
                            panel.webview.postMessage({
                                command: 'updatePlaybackState',
                                playbackState: await getPlaybackState()
                            });
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
                                    track: await getCurrentPlaying(),
                                    playbackState: await getPlaybackState()
                                });
                            }, 1000);
                            return;
                        case 'addPlaylistToQueue':
                            const tracks = await getPlaylistTracks(message.playlistId);
                            await addMultipleToQueue(tracks);
                            panel.webview.postMessage({
                                command: 'updateQueue',
                                queue: customQueue,
                                currentIndex: currentQueueIndex
                            });
                            vscode.window.showInformationMessage(`Added ${tracks.length} tracks to queue`);
                            return;
                        case 'refresh':
                            const currentTrack = await getCurrentPlaying();
                            const playbackState = await getPlaybackState();
                            panel.webview.postMessage({
                                command: 'updateCurrentTrack',
                                track: currentTrack,
                                playbackState: playbackState,
                                queue: customQueue,
                                currentIndex: currentQueueIndex,
                                autoplayEnabled: isAutoplayEnabled
                            });
                            return;
                        case 'seekTo':
                            await seekToPosition(message.position);
                            return;
                        case 'getDevices':
                            const devices = await getAvailableDevices();
                            panel.webview.postMessage({
                                command: 'updateDevices',
                                devices: devices
                            });
                            return;
                        case 'switchDevice':
                            await switchDevice(message.deviceId);
                            vscode.window.showInformationMessage('Switched playback device');
                            return;
                    }
                },
                undefined,
                context.subscriptions
            );
        })
    );
}

export function deactivate() {
    if (playbackMonitorInterval) {
        clearInterval(playbackMonitorInterval);
    }
}

// Settings management
async function loadSettings(): Promise<void> {
    customQueue = context.globalState.get('spotifyQueue', []);
    currentQueueIndex = context.globalState.get('spotifyQueueIndex', 0);
    isAutoplayEnabled = context.globalState.get('spotifyAutoplay', true);
}

async function saveSettings(): Promise<void> {
    await context.globalState.update('spotifyQueue', customQueue);
    await context.globalState.update('spotifyQueueIndex', currentQueueIndex);
    await context.globalState.update('spotifyAutoplay', isAutoplayEnabled);
}

// Playback monitoring for autoplay
function startPlaybackMonitoring(): void {
    if (playbackMonitorInterval) {
        clearInterval(playbackMonitorInterval);
    }
    
    playbackMonitorInterval = setInterval(async () => {
        if (isAutoplayEnabled && customQueue.length > 0) {
            try {
                const playback = await spotifyApi.getMyCurrentPlaybackState();
                if (playback.body && !playback.body.is_playing && playback.body.progress_ms === 0) {
                    // Track ended, play next from queue
                    await playNextFromQueue();
                }
            } catch (error) {
                // Ignore errors in monitoring
            }
        }
    }, 5000); // Check every 5 seconds
}

// Queue management functions
async function addToQueue(track: { name: string, artist: string, uri: string, id: string }): Promise<void> {
    customQueue.push(track);
    await saveSettings();
}

async function addMultipleToQueue(tracks: Array<{ name: string, artist: string, uri: string, id?: string }>): Promise<void> {
    const tracksWithId = tracks.map(track => ({
        ...track,
        id: track.id || track.uri.split(':').pop() || ''
    }));
    customQueue.push(...tracksWithId);
    await saveSettings();
}

function removeFromQueue(index: number): void {
    if (index >= 0 && index < customQueue.length) {
        customQueue.splice(index, 1);
        if (currentQueueIndex >= index && currentQueueIndex > 0) {
            currentQueueIndex--;
        }
        saveSettings();
    }
}

async function playFromQueue(index: number): Promise<void> {
    if (index >= 0 && index < customQueue.length) {
        const track = customQueue[index];
        currentQueueIndex = index;
        await playTrack(track.uri);
        await saveSettings();
    }
}

async function playNextFromQueue(): Promise<void> {
    if (currentQueueIndex < customQueue.length - 1) {
        currentQueueIndex++;
        const track = customQueue[currentQueueIndex];
        await playTrack(track.uri);
        await saveSettings();
    }
}

function clearQueue(): void {
    customQueue = [];
    currentQueueIndex = 0;
    saveSettings();
}

// Enhanced playback controls
async function getPlaybackState(): Promise<any> {
    try {
        await ensureValidToken();
        const data = await spotifyApi.getMyCurrentPlaybackState();
        if (data.body) {
            return {
                isPlaying: data.body.is_playing,
                shuffleState: data.body.shuffle_state,
                repeatState: data.body.repeat_state,
                volume: data.body.device?.volume_percent || 50,
                progress: data.body.progress_ms,
                duration: data.body.item ? ('duration_ms' in data.body.item ? data.body.item.duration_ms : 0) : 0,
                device: data.body.device
            };
        }
        return null;
    } catch (error) {
        console.error('Error getting playback state:', error);
        return null;
    }
}

async function setVolume(volume: number): Promise<void> {
    try {
        await ensureValidToken();
        await spotifyApi.setVolume(volume);
        vscode.window.showInformationMessage(`Volume set to ${volume}%`);
    } catch (error) {
        console.error('Error setting volume:', error);
        vscode.window.showErrorMessage('Error setting volume');
    }
}

async function toggleShuffle(): Promise<void> {
    try {
        await ensureValidToken();
        const playback = await spotifyApi.getMyCurrentPlaybackState();
        if (playback.body) {
            const newShuffleState = !playback.body.shuffle_state;
            await spotifyApi.setShuffle(newShuffleState);
            vscode.window.showInformationMessage(`Shuffle ${newShuffleState ? 'enabled' : 'disabled'}`);
        }
    } catch (error) {
        console.error('Error toggling shuffle:', error);
        vscode.window.showErrorMessage('Error toggling shuffle');
    }
}

async function toggleRepeat(): Promise<void> {
    try {
        await ensureValidToken();
        const playback = await spotifyApi.getMyCurrentPlaybackState();
        if (playback.body) {
            let newRepeatState: 'off' | 'track' | 'context';
            switch (playback.body.repeat_state) {
                case 'off':
                    newRepeatState = 'context';
                    break;
                case 'context':
                    newRepeatState = 'track';
                    break;
                case 'track':
                default:
                    newRepeatState = 'off';
                    break;
            }
            await spotifyApi.setRepeat(newRepeatState);
            const repeatText = newRepeatState === 'off' ? 'disabled' : 
                             newRepeatState === 'track' ? 'enabled (track)' : 'enabled (playlist)';
            vscode.window.showInformationMessage(`Repeat ${repeatText}`);
        }
    } catch (error) {
        console.error('Error toggling repeat:', error);
        vscode.window.showErrorMessage('Error toggling repeat');
    }
}

async function seekToPosition(positionMs: number): Promise<void> {
    try {
        await ensureValidToken();
        await spotifyApi.seek(positionMs);
    } catch (error) {
        console.error('Error seeking:', error);
        vscode.window.showErrorMessage('Error seeking track');
    }
}

async function previousTrack(): Promise<void> {
    try {
        await ensureValidToken();
        await spotifyApi.skipToPrevious();
    } catch (error) {
        console.error('Previous track error:', error);
        vscode.window.showErrorMessage('Error going to previous track');
    }
}

async function getAvailableDevices(): Promise<Array<any>> {
    try {
        await ensureValidToken();
        const data = await spotifyApi.getMyDevices();
        return data.body.devices.map(device => ({
            id: device.id,
            name: device.name,
            type: device.type,
            isActive: device.is_active,
            volume: device.volume_percent
        }));
    } catch (error) {
        console.error('Error getting devices:', error);
        return [];
    }
}

async function switchDevice(deviceId: string): Promise<void> {
    try {
        await ensureValidToken();
        await spotifyApi.transferMyPlayback([deviceId]);
    } catch (error) {
        console.error('Error switching device:', error);
        vscode.window.showErrorMessage('Error switching playback device');
    }
}

// Token management (unchanged)
async function initializeTokens(): Promise<void> {
    ACCESS_TOKEN = context.globalState.get('spotifyAccessToken', INITIAL_ACCESS_TOKEN);
    tokenExpiresAt = context.globalState.get('spotifyTokenExpiresAt', 0);

    if (tokenExpiresAt === 0 || Date.now() >= tokenExpiresAt) {
        console.log('Token expired or not found, will refresh on first use');
        tokenExpiresAt = 0;
    }

    spotifyApi.setAccessToken(ACCESS_TOKEN);
}

async function storeTokenData(accessToken: string, expiresIn: number): Promise<void> {
    ACCESS_TOKEN = accessToken;
    tokenExpiresAt = Date.now() + ((expiresIn - 300) * 1000);

    await context.globalState.update('spotifyAccessToken', ACCESS_TOKEN);
    await context.globalState.update('spotifyTokenExpiresAt', tokenExpiresAt);

    spotifyApi.setAccessToken(ACCESS_TOKEN);
}

async function ensureValidToken(): Promise<void> {
    if (Date.now() >= (tokenExpiresAt - 5 * 60 * 1000)) {
        console.log('Token expired or expiring soon, refreshing...');
        await refreshAccessToken();
    }
}

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

        const data = await response.json() as { access_token: string; expires_in: number };
        await storeTokenData(data.access_token, data.expires_in);

        console.log('Spotify access token refreshed successfully');

    } catch (error) {
        console.error('Error refreshing token:', error);
        vscode.window.showErrorMessage('Failed to refresh Spotify token. Extension may not work properly.');
    }
}

// Existing functions (unchanged but some enhanced)
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

async function getPlaylistTracks(playlistId: string): Promise<Array<{ name: string, artist: string, uri: string, id: string }>> {
    try {
        await ensureValidToken();
        const data = await spotifyApi.getPlaylistTracks(playlistId, { limit: 50 });
        return data.body.items
            .filter(item => item.track && item.track.type === 'track')
            .map(item => ({
                name: item.track!.name,
                artist: item.track!.artists.map(artist => artist.name).join(', '),
                uri: item.track!.uri,
                id: item.track!.id
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
            if ('artists' in track) {
                const artists = (track.artists as Array<{ name: string }>).map(artist => artist.name).join(', ');
                return `${track.name} - ${artists}`;
            } else {
                return track.name;
            }
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

async function getWebviewContent(context: vscode.ExtensionContext): Promise<string> {
    const currentTrack = await getCurrentPlaying();
    const playlists = await getPlaylists();
    const playbackState = await getPlaybackState();
    const devices = await getAvailableDevices();

    const htmlPath = path.join(context.extensionPath, 'src', 'media', 'panel.html');
    let html = fs.readFileSync(htmlPath, 'utf8');

    // Inject initial data
    const initScript = `
        <script>
            window.initialData = {
                currentTrack: ${JSON.stringify(currentTrack)},
                playlists: ${JSON.stringify(playlists)},
                playbackState: ${JSON.stringify(playbackState)},
                queue: ${JSON.stringify(customQueue)},
                currentQueueIndex: ${currentQueueIndex},
                autoplayEnabled: ${isAutoplayEnabled},
                devices: ${JSON.stringify(devices)}
            };
        </script>
    `;

    html = html.replace('</head>', `${initScript}</head>`);

    return html;
}
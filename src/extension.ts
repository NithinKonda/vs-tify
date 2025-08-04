import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
  // Create status bar item
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.text = '$(play-circle) Spotify';
  statusBarItem.command = 'spotify-personal.openSpotifyPanel';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Register command to open webview
  context.subscriptions.push(
    vscode.commands.registerCommand('spotify-personal.openSpotifyPanel', () => {
      const panel = vscode.window.createWebviewPanel(
        'spotifyPanel',
        'Spotify',
        vscode.ViewColumn.One,
        { enableScripts: true }
      );
      panel.webview.html = getWebviewContent(); // We'll define this function later
    })
  );
}

export function deactivate() {}

// Placeholder for webview HTML
function getWebviewContent() {
  return `<!DOCTYPE html>
  <html lang="en">
  <head><title>Spotify Panel</title></head>
  <body><h1>Spotify Integration</h1></body>
  </html>`;
}

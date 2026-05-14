#!/usr/bin/env fish
# Installs the native messaging host for Chrome, Chromium, and Firefox (macOS/Linux).

set SCRIPT_DIR (cd (dirname (status filename)); and pwd)
set HOST_PATH $SCRIPT_DIR/host.py
set HOST_NAME com.ytdl_queue.host

# Firefox extension ID — must match manifest.json browser_specific_settings.gecko.id
set FIREFOX_EXT_ID ytdl-queue@local

# Chrome/Chromium extension ID — set via:  CHROME_EXT_ID=<id> fish install.fish
set CHROME_EXT_ID (set -q CHROME_EXT_ID; and echo $CHROME_EXT_ID; or echo __REPLACE_WITH_CHROME_EXTENSION_ID__)

chmod +x $HOST_PATH

# ─── Helpers ──────────────────────────────────────────────────────────────────

function install_manifest
    set -l dir $argv[1]
    set -l content $argv[2]
    mkdir -p $dir
    echo $content > $dir/$HOST_NAME.json
    echo "  → $dir/$HOST_NAME.json"
end

# ─── Chrome / Chromium ───────────────────────────────────────────────────────

set CHROME_MANIFEST '{
  "name": "'$HOST_NAME'",
  "description": "yt-dlp Queue file writer",
  "path": "'$HOST_PATH'",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://'$CHROME_EXT_ID'/"]
}'

if test (uname) = Darwin
    install_manifest "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts" $CHROME_MANIFEST
    install_manifest "$HOME/Library/Application Support/Chromium/NativeMessagingHosts" $CHROME_MANIFEST
else
    install_manifest "$HOME/.config/google-chrome/NativeMessagingHosts" $CHROME_MANIFEST
    install_manifest "$HOME/.config/chromium/NativeMessagingHosts" $CHROME_MANIFEST
end

# ─── Firefox ─────────────────────────────────────────────────────────────────

set FIREFOX_MANIFEST '{
  "name": "'$HOST_NAME'",
  "description": "yt-dlp Queue file writer",
  "path": "'$HOST_PATH'",
  "type": "stdio",
  "allowed_extensions": ["'$FIREFOX_EXT_ID'"]
}'

if test (uname) = Darwin
    install_manifest "$HOME/Library/Application Support/Mozilla/NativeMessagingHosts" $FIREFOX_MANIFEST
else
    install_manifest "$HOME/.mozilla/native-messaging-hosts" $FIREFOX_MANIFEST
end

# ─── Done ────────────────────────────────────────────────────────────────────

echo ""
echo "Native host installed for Chrome, Chromium, and Firefox."
echo ""

if string match -q '__REPLACE*' $CHROME_EXT_ID
    echo "⚠  Chrome extension ID not set. After loading the extension in Chrome:"
    echo "   1. Find the ID at chrome://extensions"
    echo "   2. Re-run:  CHROME_EXT_ID=<id> fish install.fish"
    echo ""
end

set EXT_DIR (dirname $SCRIPT_DIR)
echo "Load the unpacked extension:"
echo "  Chrome:  chrome://extensions → Developer mode → Load unpacked → $EXT_DIR"
echo "  Firefox: about:debugging → This Firefox → Load Temporary Add-on → $EXT_DIR/manifest.json"

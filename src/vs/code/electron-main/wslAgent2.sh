#!/usr/bin/env bash

COMMIT="@@COMMIT@@"
VSCODE_REMOTE_BIN="$HOME/.vscode-remote/bin"

./wslDownload.sh $COMMIT

"$VSCODE_REMOTE_BIN/$COMMIT/node" "$VSCODE_REMOTE_BIN/$COMMIT/out/remoteExtensionHostAgent.js"

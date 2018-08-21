#!/usr/bin/env bash

if [ $# -eq 0 ] ; then
	echo "Invoke with commit sha as first argument"
	exit 1
else
	COMMIT=$1
fi

VSCODE_REMOTE_BIN="$HOME/.vscode-remote/bin"

./wslDownload.sh $1

"$VSCODE_REMOTE_BIN/$COMMIT/node" "$VSCODE_REMOTE_BIN/$COMMIT/out/remoteExtensionHostAgent.js"

#!/usr/bin/env bash

if [ $# -eq 0 ] ; then
	# COMMIT="b95183a27e8ca39ce00ec2a2d6f023be7dd51d6d"
	echo "Invoke with commit sha as first argument"
	exit 1
else
	COMMIT=$1
fi

VSCODE_REMOTE_BIN="$HOME/.vscode-remote/bin"
DOWNLOAD_URL="https://az764295.vo.msecnd.net/wsl/$COMMIT/vscode-headless-x64.tar.gz"

# Check if this version is already installed
if [ ! -d "$VSCODE_REMOTE_BIN/$COMMIT" ]; then
	# This version does not exist
	if [ -d "$VSCODE_REMOTE_BIN" ]; then
		echo "Updating Code WSL components to version $COMMIT"
	else
		echo "Installing Code WSL components $COMMIT"
	fi

	mkdir -p "$VSCODE_REMOTE_BIN"

	# Download the .tar.gz file
	TMP_NAME="$COMMIT-$(date +%s)"
	echo "Downloading...";
	wget -O "$VSCODE_REMOTE_BIN/$TMP_NAME.tar.gz" $DOWNLOAD_URL

	# Unpack the .tar.gz file to a temporary folder name
	echo "Unpacking...";
	mkdir "$VSCODE_REMOTE_BIN/$TMP_NAME"
	tar -xf "$VSCODE_REMOTE_BIN/$TMP_NAME.tar.gz" -C "$VSCODE_REMOTE_BIN/$TMP_NAME" --strip-components 1

	# Rename temporary folder to final folder name
	echo "Finalizing...";
	mv "$VSCODE_REMOTE_BIN/$TMP_NAME" "$VSCODE_REMOTE_BIN/$COMMIT"

	# Remove the .tar.gz file
	echo "Cleaning up...";
	rm "$VSCODE_REMOTE_BIN/$TMP_NAME.tar.gz"
fi

$VSCODE_REMOTE_BIN/$COMMIT/node $VSCODE_REMOTE_BIN/$COMMIT/out/remoteExtensionHostAgent.js

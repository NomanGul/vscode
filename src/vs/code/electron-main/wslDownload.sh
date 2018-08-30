#!/usr/bin/env bash

if [ $# -eq 0 ] ; then
	echo "Invoke with commit sha as first argument"
	exit 1
else
	COMMIT=$1
fi

VSCODE_REMOTE_BIN="$HOME/.vscode-remote/bin"
DOWNLOAD_URL="https://az764295.vo.msecnd.net/wsl/$COMMIT/vscode-headless-linux-x64.tar.gz"
CLI_JS_PATH="$(dirname "$(realpath "$0")")/../../../cli-wsl.js"

download()
{
	local url=$1
	local name=$2
	echo -n "    "
	wget -O $name --progress=dot $url 2>&1 | grep --line-buffered "%" | \
		sed -u -e "s,\.,,g" | awk '{printf("\b\b\b\b%4s", $2)}'
	echo -ne "\b\b\b\b"
	echo " DONE"
}

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
	download $DOWNLOAD_URL "$VSCODE_REMOTE_BIN/$TMP_NAME.tar.gz"

	# Unpack the .tar.gz file to a temporary folder name
	echo "Unpacking...";
	mkdir "$VSCODE_REMOTE_BIN/$TMP_NAME"
	tar -xf "$VSCODE_REMOTE_BIN/$TMP_NAME.tar.gz" -C "$VSCODE_REMOTE_BIN/$TMP_NAME" --strip-components 1 --verbose

	echo "Copying scripts...";
	cp "$CLI_JS_PATH" "$VSCODE_REMOTE_BIN/$TMP_NAME"

	# Rename temporary folder to final folder name
	echo "Finalizing...";
	mv "$VSCODE_REMOTE_BIN/$TMP_NAME" "$VSCODE_REMOTE_BIN/$COMMIT"

	# Remove the .tar.gz file
	echo "Cleaning up...";
	rm "$VSCODE_REMOTE_BIN/$TMP_NAME.tar.gz"
fi

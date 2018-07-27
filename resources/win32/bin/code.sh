#!/usr/bin/env bash
#
# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root for license information.

NAME="@@NAME@@"
VERSION="@@VERSION@@"
VSCODE_PATH="$(dirname "$(dirname "$(realpath "$0")")")"
ELECTRON="$VSCODE_PATH/$NAME.exe"
if grep -q Microsoft /proc/version; then
	VSCODE_REMOTE="$HOME/.vscode-remote"
	if [ ! -f "$VSCODE_REMOTE/node_modules/$VERSION" ]; then
		if [ -d "$VSCODE_REMOTE/node_modules" ]; then
			echo "Updating Code WSL components to version $VERSION"
			rm -rf "$VSCODE_REMOTE/node_modules"
			rm -f "$VSCODE_REMOTE/node"
			rm -f "$VSCODE_REMOTE/cli-wsl.js"
		else
			echo "Installing Code WSL components ($VERSION)"
		fi
		mkdir -p "$VSCODE_REMOTE"
		tar -xf "$VSCODE_PATH/VSCode-wsl-x64.tar.gz" -C "$VSCODE_REMOTE"
		cp "$VSCODE_PATH/resources/app/out/cli-wsl.js" "$VSCODE_REMOTE"
		touch "$VSCODE_REMOTE/node_modules/$VERSION"
	fi
	SCRIPT_NAME="$(basename "$(test -L "$0" && readlink "$0" || echo "$0")")"
	if [ -x /bin/wslpath ]; then
		# On recent WSL builds, we just need to set WSLENV so that
		# ELECTRON_RUN_AS_NODE is visible to the win32 process
		export WSLENV=ELECTRON_RUN_AS_NODE/w:$WSLENV
		export ELECTRON_RUN_AS_NODE=1
		CLI=$(wslpath -m "$VSCODE_PATH/resources/app/out/cli.js")
		"$VSCODE_REMOTE/node" "$VSCODE_REMOTE/cli-wsl.js" "$SCRIPT_NAME" "$ELECTRON" "$CLI" "$@"
		exit $?
	else
		# If running under older WSL, run the default code.cmd as
		# we can't set env variables or translate paths
		# See: https://github.com/Microsoft/BashOnWindows/issues/1363
		#      https://github.com/Microsoft/BashOnWindows/issues/1494
		VSCODE_WIN_CMD=$(wslpath -m "$VSCODE_PATH/bin/code-wsl.cmd")
		"$VSCODE_REMOTE/node" "$VSCODE_REMOTE/cli-wsl.js" "$SCRIPT_NAME" "$VSCODE_WIN_CMD" "--" "$@"
		exit $?
	fi
elif [ "$(expr substr $(uname -s) 1 9)" == "CYGWIN_NT" ]; then
	CLI=$(cygpath -m "$VSCODE_PATH/resources/app/out/cli.js")
else
	CLI="$VSCODE_PATH/resources/app/out/cli.js"
fi

ELECTRON_RUN_AS_NODE=1 "$ELECTRON" "$CLI" "$@"
exit $?
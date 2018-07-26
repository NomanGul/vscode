#!/usr/bin/env bash
#
# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root for license information.

NAME="@@NAME@@"
VSCODE_PATH="$(dirname "$(dirname "$(realpath "$0")")")"
ELECTRON="$VSCODE_PATH/$NAME.exe"
if grep -q Microsoft /proc/version; then
	if [ -x /bin/wslpath ]; then
		VSCODE_REMOTE="$HOME/.vscode-remote"
		if [ ! -d $VSCODE_REMOTE/node_modules ]; then
			echo "Installing VSCode WSL components..."
			mkdir -p $VSCODE_REMOTE
			tar -xf "$VSCODE_PATH/VSCode-wsl-x64.tar.gz" -C "$VSCODE_REMOTE"
			cp $VSCODE_PATH/resources/app/out/cli-wsl.js $VSCODE_REMOTE
		fi
		SCRIPT_NAME="$(basename "$(test -L "$0" && readlink "$0" || echo "$0")")"
		# On recent WSL builds, we just need to set WSLENV so that
		# ELECTRON_RUN_AS_NODE is visible to the win32 process
		export WSLENV=ELECTRON_RUN_AS_NODE/w:$WSLENV
		$VSCODE_REMOTE/node "$VSCODE_REMOTE/cli-wsl.js" "$SCRIPT_NAME" "$ELECTRON" "$@"
		exit $?
	else
		# If running under older WSL, don't pass cli.js to Electron as
		# environment vars cannot be transferred from WSL to Windows
		# See: https://github.com/Microsoft/BashOnWindows/issues/1363
		#      https://github.com/Microsoft/BashOnWindows/issues/1494
		"$ELECTRON" "$@"
		exit $?
	fi
elif [ "$(expr substr $(uname -s) 1 9)" == "CYGWIN_NT" ]; then
	CLI=$(cygpath -m "$VSCODE_PATH/resources/app/out/cli.js")
else
	CLI="$VSCODE_PATH/resources/app/out/cli.js"
fi

ELECTRON_RUN_AS_NODE=1 "$ELECTRON" "$CLI" "$@"
exit $?

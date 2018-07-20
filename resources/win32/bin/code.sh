#!/usr/bin/env bash
#
# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root for license information.

NAME="@@NAME@@"
VSCODE_PATH="$(dirname "$(dirname "$(realpath "$0")")")"
ELECTRON="$VSCODE_PATH/$NAME.exe"
VSCODE_REMOTE="$HOME/.vscode-remote"
WSL=""
if grep -q Microsoft /proc/version; then
	if [ -x /bin/wslpath ]; then
		if [ ! -d $VSCODE_REMOTE/node_modules ]; then
			echo "Installing VSCode WSL components..."
			mkdir -p $VSCODE_REMOTE
			tar -xf $VSCODE_PATH/VSCode-wsl-x64.tar.gz -C $VSCODE_REMOTE
		fi
		# On recent WSL builds, we just need to set WSLENV so that
		# ELECTRON_RUN_AS_NODE is visible to the win32 process
		WSL="--wsl"
		export WSLENV=ELECTRON_RUN_AS_NODE/w:$WSLENV
		CLI=$(wslpath -m "$VSCODE_PATH/resources/app/out/cli.js")
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
echo $ELECTRON

ELECTRON_RUN_AS_NODE=1 "$ELECTRON" "$CLI" "$WSL" "$@"
exit $?

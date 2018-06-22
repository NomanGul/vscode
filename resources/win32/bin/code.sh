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
			echo "Checking WSL dependencies"
			echo "-------------------------"
			mkdir -p $VSCODE_REMOTE
			cp $VSCODE_PATH/resources/app/remote/package.json $VSCODE_REMOTE
			pushd $VSCODE_REMOTE > /dev/null
			npm --silent install
			popd > /dev/null
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

ELECTRON_RUN_AS_NODE=1 "$ELECTRON" "$CLI" "$WSL" "$@"
exit $?

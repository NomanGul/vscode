#!/usr/bin/env bash
#
# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root for license information.

NAME="@@NAME@@"
VERSION="@@VERSION@@"
COMMIT="@@COMMIT@@"
VSCODE_PATH="$(dirname "$(dirname "$(realpath "$0")")")"
ELECTRON="$VSCODE_PATH/$NAME.exe"
if grep -q Microsoft /proc/version; then
	VSCODE_REMOTE="$HOME/.vscode-remote"
	VSCODE_REMOTE_BIN="$HOME/.vscode-remote/bin"
	"$VSCODE_PATH/resources/app/out/vs/code/electron-main/wslDownload.sh" $COMMIT
	SCRIPT_NAME="$(basename "$(test -L "$0" && readlink "$0" || echo "$0")")"
	if [ -x /bin/wslpath ]; then
		# On recent WSL builds, we just need to set WSLENV so that
		# ELECTRON_RUN_AS_NODE is visible to the win32 process
		export WSLENV=ELECTRON_RUN_AS_NODE/w:$WSLENV
		export ELECTRON_RUN_AS_NODE=1
		CLI=$(wslpath -m "$VSCODE_PATH/resources/app/out/cli.js")
		"$VSCODE_REMOTE_BIN/$COMMIT/node" "$VSCODE_REMOTE_BIN/$COMMIT/cli-wsl.js" "$SCRIPT_NAME" "$ELECTRON" "$CLI" "$@"
		exit $?
	else
		# If running under older WSL, run the default code.cmd as
		# we can't set env variables or translate paths
		# See: https://github.com/Microsoft/BashOnWindows/issues/1363
		#      https://github.com/Microsoft/BashOnWindows/issues/1494
		VSCODE_WIN_CMD=$(wslpath -m "$VSCODE_PATH/bin/code-wsl.cmd")
		"$VSCODE_REMOTE_BIN/$COMMIT/node" "$VSCODE_REMOTE_BIN/$COMMIT/cli-wsl.js" "$SCRIPT_NAME" "$VSCODE_WIN_CMD" "--" "$@"
		exit $?
	fi
elif [ "$(expr substr $(uname -s) 1 9)" == "CYGWIN_NT" ]; then
	CLI=$(cygpath -m "$VSCODE_PATH/resources/app/out/cli.js")
else
	CLI="$VSCODE_PATH/resources/app/out/cli.js"
fi

ELECTRON_RUN_AS_NODE=1 "$ELECTRON" "$CLI" "$@"
exit $?
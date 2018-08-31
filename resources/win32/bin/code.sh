#!/usr/bin/env bash
#
# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root for license information.

NAME="@@NAME@@"
COMMIT="@@COMMIT@@"
SCRIPT_NAME="@@APPNAME@@"
VSCODE_PATH="$(dirname "$(dirname "$(realpath "$0")")")"
if grep -q Microsoft /proc/version; then
	VSCODE_REMOTE_BIN="$HOME/.vscode-remote/bin"
	"$VSCODE_PATH/resources/app/out/vs/code/electron-main/wslDownload.sh" $COMMIT
	if [ "$1" == "--headless" ]; then
		if [[ $2 ]]; then
			"$VSCODE_REMOTE_BIN/$COMMIT/node" "$2" "$VSCODE_REMOTE_BIN/$COMMIT/out/remoteExtensionHostAgent.js"
		else
			"$VSCODE_REMOTE_BIN/$COMMIT/node" "$VSCODE_REMOTE_BIN/$COMMIT/out/remoteExtensionHostAgent.js"
		fi
	else
		VSCODE_WIN_CMD="$SCRIPT_NAME.cmd"
		"$VSCODE_REMOTE_BIN/$COMMIT/node" "$VSCODE_REMOTE_BIN/$COMMIT/cli-wsl.js" "$SCRIPT_NAME" "$VSCODE_WIN_CMD" $@
	fi
	exit $?
elif [ "$(expr substr $(uname -s) 1 9)" == "CYGWIN_NT" ]; then
	CLI=$(cygpath -m "$VSCODE_PATH/resources/app/out/cli.js")
else
	CLI="$VSCODE_PATH/resources/app/out/cli.js"
fi
ELECTRON="$VSCODE_PATH/$NAME.exe"
ELECTRON_RUN_AS_NODE=1 "$ELECTRON" "$CLI" "$@"
exit $?
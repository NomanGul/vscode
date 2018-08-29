#!/usr/bin/env bash
#
# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root for license information.

VSCODE_PATH="$(dirname "$(dirname "$(realpath "$0")")")"
SCRIPT_NAME="$(basename "$(test -L "$0" && readlink "$0" || echo "$0")")"
if grep -q Microsoft /proc/version; then
	if [ -x /bin/wslpath ]; then
		if [ $1 == '--init' ] || [ -e "$VSCODE_PATH/remote/node_modules/node-pty/build/binding.sln" ] ; then
			rm -r "$VSCODE_PATH/remote/node_modules"
		fi
		echo "Using $VSCODE_PATH as remote folder"
		if [ ! -d "$VSCODE_PATH/remote/node_modules" ]; then
			echo "Installing VSCode WSL components..."
			cd "$VSCODE_PATH/remote"
			yarn
			cd "$VSCODE_PATH/extensions/search-rg"
			yarn
		fi
		cp "$VSCODE_PATH/out/cli-wsl.js" "$VSCODE_PATH/remote"
		node "$VSCODE_PATH/remote/cli-wsl.js" "$SCRIPT_NAME" "$(wslpath -m $VSCODE_PATH/scripts/code-cli.bat)" "--" "$@"
		exit $?
	else
		echo "wslpath not available."
		exit $?
	fi

else
	echo "not inside a wsl shell."
	exit $?
fi

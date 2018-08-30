#!/usr/bin/env bash
#
# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root for license information.

VSCODE_PATH="$(dirname "$(dirname "$(realpath "$0")")")"

if grep -q Microsoft /proc/version; then
	if [ $1 == '--init' ] || [ -e "$VSCODE_PATH/remote/node_modules/node-pty/build/binding.sln" ] ; then
		rm -r "$VSCODE_PATH/remote/node_modules"
	fi
	if [ ! -d "$VSCODE_PATH/remote/node_modules" ]; then
		echo "Installing VSCode WSL natives to $VSCODE_PATH/remote..."
		cd "$VSCODE_PATH/remote"
		yarn
		cd "$VSCODE_PATH/extensions/search-rg"
		yarn
	fi
	if [ "$1" == "--headless" ]; then
		NODE_ENV=development \
		VSCODE_DEV=1 \
		node "$VSCODE_PATH/out/remoteExtensionHostAgent.js" --builtin-extensions=extension-editing,configuration-editing,search-rg,css-language-features,git,grunt,gulp,html-language-features,json-language-features,markdown-language-features,npm,php-language-features,typescript-language-features,../.build/builtInExtensions/ms-vscode.node-debug,../.build/builtInExtensions/ms-vscode.node-debug2 "$@"
	else
		SCRIPT_NAME="$(basename "$(test -L "$0" && readlink "$0" || echo "$0")")"
		cp "$VSCODE_PATH/out/cli-wsl.js" "$VSCODE_PATH/remote"
		node "$VSCODE_PATH/remote/cli-wsl.js" "$SCRIPT_NAME" "code-cli.bat" "$@"
	fi
	exit $?
else
	echo "not inside a wsl shell."
	exit $?
fi

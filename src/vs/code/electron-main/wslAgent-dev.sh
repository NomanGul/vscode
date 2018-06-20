#!/usr/bin/env bash

ROOT=$(dirname $(dirname $(dirname $(dirname $(dirname $(readlink -f $0))))))

function code() {
	NODE_ENV=development \
	VSCODE_DEV=1 \
	node "$ROOT/out/remoteExtensionHostAgent.js" --builtin-extensions=extension-editing,configuration-editing,search-rg,css-language-features,git,grunt,gulp,html-language-features,json-language-features,markdown-language-features,npm,php-language-features,typescript-language-features,../.build/builtInExtensions/ms-vscode.node-debug,../.build/builtInExtensions/ms-vscode.node-debug2 "$@"
}

code "$@"
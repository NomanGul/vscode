#!/usr/bin/env bash

ROOT=$(dirname $(dirname $(dirname $(dirname $(dirname $(readlink -f $0))))))

function code() {
	$HOME/.vscode-remote/node "$ROOT/out/remoteExtensionHostAgent.js" --builtin-extensions=extension-editing,configuration-editing,search-rg,css-language-features,git,grunt,gulp,html-language-features,json-language-features,markdown-language-features,npm,php-language-features,typescript-language-features,ms-vscode.node-debug,ms-vscode.node-debug2 "$@"
}

code "$@"
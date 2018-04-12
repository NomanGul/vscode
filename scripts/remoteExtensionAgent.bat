@echo off
setlocal

title VSCode Remote Agent

pushd %~dp0\..

:: Configuration
set NODE_ENV=development
set VSCODE_DEV=1

:: Launch Agent
node out\remoteExtensionHostAgent.js --builtin-extensions=css-language-features,git,grunt,gulp,html-language-features,json-language-features,markdown-language-features,npm,php-language-features,typescript-language-features,../.build/builtInExtensions/ms-vscode.node-debug,../.build/builtInExtensions/ms-vscode.node-debug2 %*

popd

endlocal

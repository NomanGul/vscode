#!/bin/sh
cd /vscode/remote
npm install
mkdir -p bin
cp /node/bin/node ./bin
tar -czvf linux64-remote.tar.gz bin node_modules
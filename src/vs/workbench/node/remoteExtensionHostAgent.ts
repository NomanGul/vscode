/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import * as os from 'os';
import * as path from 'path';
import * as minimist from 'minimist';
import * as fs from 'fs';
import * as net from 'net';
import URI from 'vs/base/common/uri';
import { ParsedArgs } from 'vs/platform/environment/common/environment';
import { RemoteExtensionManagementServer } from 'vs/workbench/node/remoteExtensionsManagement';
import { ExtensionHostConnection } from 'vs/workbench/node/remoteExtensionHostServer';
import { EnvironmentService } from 'vs/platform/environment/node/environmentService';
import { REMOTE_SOCKET_HANDSHAKE_MANAGEMENT, REMOTE_SOCKET_HANDSHAKE_EXT_HOST } from 'vs/platform/remote/node/remoteFileSystemIpc';

const ifaces = os.networkInterfaces();

Object.keys(ifaces).forEach(function (ifname) {
	ifaces[ifname].forEach(function (iface) {
		if (!iface.internal && iface.family === 'IPv4') {
			console.log(`IP Address: ${iface.address}`);
		}
	});
});

const args = minimist(process.argv.slice(2), {
	string: [
		'builtin-extensions'
	],
}) as ParsedArgs;

const REMOTE_DATA_FOLDER = path.join(os.homedir(), '.vscode-remote');
const USER_DATA_PATH = path.join(REMOTE_DATA_FOLDER, 'data');
const APP_SETTINGS_HOME = path.join(USER_DATA_PATH, 'User');
const LOGS_FOLDER = path.join(USER_DATA_PATH, 'logs');
args['user-data-dir'] = USER_DATA_PATH;
const APP_ROOT = path.dirname(URI.parse(require.toUrl('')).fsPath);
const BUILTIN_EXTENSIONS_FOLDER_PATH = path.join(APP_ROOT, 'extensions');
args['builtin-extensions-dir'] = BUILTIN_EXTENSIONS_FOLDER_PATH;
if (typeof args['builtin-extensions'] === 'string') {
	args['builtin-extensions'] = args['builtin-extensions'].split(',');
} else {
	args['builtin-extensions'] = [];
}

const EXTENSIONS_PATH = path.join(REMOTE_DATA_FOLDER, 'extensions');
args['extensions-dir'] = EXTENSIONS_PATH;

[REMOTE_DATA_FOLDER, EXTENSIONS_PATH, USER_DATA_PATH, APP_SETTINGS_HOME, LOGS_FOLDER].forEach(f => {
	try {
		if (!fs.existsSync(f)) {
			fs.mkdirSync(f);
		}
	} catch (err) { console.error(err); }
});

console.log(`Remote configuration data at ${REMOTE_DATA_FOLDER}`);
console.log(`Remote extensions: ${fs.readdirSync(EXTENSIONS_PATH).join(', ')}`);

const remoteExtensionManagementServer = new RemoteExtensionManagementServer(new EnvironmentService(args, process.execPath));

class ExtensionHostAgentServer {

	public start(port: number) {
		const server = net.createServer();
		server.on('error', (err) => {
			console.error(`Error occurred in server`);
			console.error(err);
		});
		server.on('connection', (socket) => this.handleConnection(socket));
		server.listen(port, () => {
			console.log(`Server listening on ${port}`);
		});
	}

	private handleConnection(socket: net.Socket): void {
		const listener = (data: Buffer) => {
			const firstByte = data[0];
			data = data.slice(1);
			if (firstByte === REMOTE_SOCKET_HANDSHAKE_MANAGEMENT) {
				// This should become a management connection
				socket.removeListener('data', listener);

				console.log(`==> Received a management connection from ${socket.address().address}`);
				remoteExtensionManagementServer.acceptConnection(socket, data);
			} else if (firstByte === REMOTE_SOCKET_HANDSHAKE_EXT_HOST) {
				// This should become an extension host connectio
				socket.removeListener('data', listener);

				console.log(`==> Received an extension host connection from ${socket.address().address}`);
				const con = new ExtensionHostConnection(socket, data);
				con.start();
			} else {
				socket.removeListener('data', listener);

				console.error(`Unknown initial data received: ${firstByte}`);
				socket.destroy();
			}
		};
		socket.on('data', listener);
	}
}

new ExtensionHostAgentServer().start(8000);

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
import { ParsedArgs, IExtensionHostDebugParams } from 'vs/platform/environment/common/environment';
import { RemoteExtensionManagementServer } from 'vs/workbench/node/remoteExtensionsManagement';
import { ExtensionHostConnection } from 'vs/workbench/node/remoteExtensionHostServer';
import { EnvironmentService } from 'vs/platform/environment/node/environmentService';
import { ConnectionType, HandshakeMessage, SignRequest, USE_VSDA } from 'vs/platform/remote/node/remoteFileSystemIpc';
import { Protocol } from 'vs/base/parts/ipc/node/ipc.net';
import { findFreePort } from 'vs/base/node/ports';

let validator: any;
if (USE_VSDA) {
	try {
		const vsda = <any>require.__$__nodeRequire('vsdb');
		validator = new vsda.validator();
	} catch (e) {
	}
}

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
	args['builtin-extensions'] = fs.readdirSync(BUILTIN_EXTENSIONS_FOLDER_PATH);
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
			// Do not change this line. VS Code looks for this in
			// the output.
			console.log(`Extension host agent listening on ${port}`);
		});
	}

	private handleConnection(socket: net.Socket): void {
		const protocol = new Protocol(socket);

		const messageRegistration = protocol.onMessage((raw => {
			const msg = <HandshakeMessage>JSON.parse(raw.toString());
			const SOME_TEXT = 'remote extension host is cool';

			if (msg.type === 'auth') {

				if (typeof msg.auth !== 'string' || msg.auth !== '00000000000000000000') {
					// TODO@vs-remote: use real nonce here
					// Invalid nonce, will not communicate further with this client
					console.error(`Unauthorized client refused.`);
					socket.destroy();
					return;
				}

				let someText = SOME_TEXT;
				if (USE_VSDA) {
					try {
						if (validator) {
							someText = validator.createNewMessage(someText);
						}
					} catch (e) {
					}
				}

				const signRequest: SignRequest = {
					type: 'sign',
					data: someText
				};
				protocol.send(Buffer.from(JSON.stringify(signRequest)));

			} else if (msg.type === 'connectionType') {

				// Stop listening for further events
				messageRegistration.dispose();

				let valid = false;

				if (USE_VSDA) {
					if (typeof msg.signedData === 'string') {
						try {
							if (validator) {
								valid = validator.validate(msg.signedData) === 'ok';
							}
						} catch (e) {
						}
					}
				} else {
					// validate the fake signing
					valid = msg.signedData === SOME_TEXT.toUpperCase();
				}

				if (!valid) {
					console.error(`Unauthorized client refused.`);
					socket.destroy();
					return;
				}

				switch (msg.desiredConnectionType) {
					case ConnectionType.Management:
						// This should become a management connection
						console.log(`==> Received a management connection from ${socket.address().address}`);
						remoteExtensionManagementServer.acceptConnection(protocol);
						break;

					case ConnectionType.ExtensionHost:
						// This should become an extension host connection
						const debugParams = <IExtensionHostDebugParams>msg.args;
						this._updateWithFreeDebugPort(debugParams).then(debugParams => {
							protocol.send(Buffer.from(JSON.stringify(debugParams ? { debugPort: debugParams.port } : {})));

							console.log(`==> Received an extension host connection from ${socket.address().address}`);
							if (debugParams) {
								console.log(`==> Debug port ${debugParams.port}`);
							}
							const con = new ExtensionHostConnection(socket, protocol);
							con.start(debugParams);
						});
						break;

					default:
						console.error(`Unknown initial data received.`);
						socket.destroy();
				}
			}
		}));
	}

	private _updateWithFreeDebugPort(debugParams: IExtensionHostDebugParams): Thenable<IExtensionHostDebugParams> {
		if (debugParams && typeof debugParams.port === 'number') {
			return findFreePort(debugParams.port, 10 /* try 10 ports */, 5000 /* try up to 5 seconds */).then(freePort => {
				debugParams.port = freePort;
				return debugParams;
			});
		}
		return Promise.resolve(void 0);
	}
}

new ExtensionHostAgentServer().start(8000);

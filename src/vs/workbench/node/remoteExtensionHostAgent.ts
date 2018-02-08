/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import * as net from 'net';
import * as http from 'http';
import * as objects from 'vs/base/common/objects';
import * as cp from 'child_process';
import * as os from 'os';
import * as path from 'path';
import pkg from 'vs/platform/node/package';
import { generateRandomPipeName } from 'vs/base/parts/ipc/node/ipc.net';
import { TPromise } from 'vs/base/common/winjs.base';
import URI from 'vs/base/common/uri';
import { fromNodeEventEmitter } from 'vs/base/common/event';
import { IRemoteConsoleLog } from 'vs/base/node/console';
import { ExtensionScanner, ExtensionScannerInput, ILog } from 'vs/workbench/services/extensions/node/extensionPoints';

const EXTENSION_FOLDER = path.join(os.homedir(), '.vscode-remote', 'extensions');

const extHostServer = net.createServer((connection) => {
	console.log(`received a connection`);
	const con = new ExtensionHostConnection(connection);
	con.start();
});
extHostServer.on('error', (err) => {
	throw err;
});
extHostServer.listen(8000, () => {
	console.log('Extension Host Server listening on 8000');
});

const httpServer = http.createServer((request, response) => {
	if (request.url === '/scan-extensions') {
		const input = new ExtensionScannerInput(
			pkg.version,
			null,
			'en', // TODO@vs-remote
			true,
			EXTENSION_FOLDER,
			true, // TODO@vs-remote built-in
			{}
		);
		const logger = new class implements ILog {
			public error(source: string, message: string): void {
				console.error(source, message);
			}
			public warn(source: string, message: string): void {
				console.warn(source, message);
			}
			public info(source: string, message: string): void {
				console.info(source, message);
			}
		};
		ExtensionScanner.scanExtensions(input, logger).then((extensions) => {
			response.writeHead(200);
			response.end(JSON.stringify(extensions));
		}, (err) => {
			response.writeHead(500);
			response.end(err);
		});
		return;
	}
	response.writeHead(404);
	response.end('Not found');
});
httpServer.on('error', (err) => {
	throw err;
});
httpServer.listen(8001, () => {
	console.log('Control server listening on 8001');
});

class ExtensionHostConnection {

	private _namedPipeServer: net.Server;
	private _extensionHostProcess: cp.ChildProcess;
	private _extensionHostConnection: net.Socket;

	constructor(private _rendererConnection: net.Socket) {
		this._namedPipeServer = null;
		this._extensionHostProcess = null;
		this._extensionHostConnection = null;

		this._rendererConnection.on('close', () => {
			this._cleanResources();
		});
	}

	private _cleanResources(): void {
		if (this._namedPipeServer) {
			this._namedPipeServer.close();
			this._namedPipeServer = null;
		}
		if (this._extensionHostConnection) {
			this._extensionHostConnection.end();
			this._extensionHostConnection = null;
		}
		if (this._extensionHostProcess) {
			this._extensionHostProcess.kill();
			this._extensionHostProcess = null;
		}
	}

	public start(): void {
		this._tryListenOnPipe().then((pipeName) => {
			const opts = {
				env: objects.mixin(objects.deepClone(process.env), {
					AMD_ENTRYPOINT: 'vs/workbench/node/extensionHostProcess',
					PIPE_LOGGING: 'true',
					VERBOSE_LOGGING: true,
					VSCODE_IPC_HOOK_EXTHOST: pipeName,
					VSCODE_HANDLES_UNCAUGHT_ERRORS: true,
					VSCODE_LOG_STACK: false
				}),
				execArgv: <string[]>undefined,
				silent: true
			};

			// Run Extension Host as fork of current process
			this._extensionHostProcess = cp.fork(URI.parse(require.toUrl('bootstrap')).fsPath, ['--type=extensionHost'], opts);

			// Catch all output coming from the extension host process
			this._extensionHostProcess.stdout.setEncoding('utf8');
			this._extensionHostProcess.stderr.setEncoding('utf8');
			const onStdout = fromNodeEventEmitter<string>(this._extensionHostProcess.stdout, 'data');
			const onStderr = fromNodeEventEmitter<string>(this._extensionHostProcess.stderr, 'data');
			onStdout((e) => console.log(`::::::::` + e));
			onStderr((e) => console.log(`::::::::` + e));


			// Support logging from extension host
			this._extensionHostProcess.on('message', msg => {
				if (msg && (<IRemoteConsoleLog>msg).type === '__$console') {
					console.log(`TODO!!!`);
					console.log((<IRemoteConsoleLog>msg).arguments);
					// this._logExtensionHostMessage(<IRemoteConsoleLog>msg);
				}
			});

			// Lifecycle
			this._extensionHostProcess.on('error', (err) => {
				console.log(`PROCESS ERRORD`);
				console.log(err);
			});

			this._extensionHostProcess.on('exit', (code: number, signal: string) => {
				console.log(`PROCESS EXITED`);
				console.log(code);
				console.log(signal);
				this._rendererConnection.end();
				// this._onExtHostProcessExit(code, signal);
			});

			return this._tryExtHostHandshake();
		}).then(() => {
			console.log(`extension host connected to me!!!`);

			this._extensionHostConnection.pipe(this._rendererConnection);
			this._rendererConnection.pipe(this._extensionHostConnection);

		});
	}

	private _tryExtHostHandshake(): TPromise<net.Socket> {

		return new TPromise<net.Socket>((resolve, reject) => {

			// Wait for the extension host to connect to our named pipe
			// and wrap the socket in the message passing protocol
			let handle = setTimeout(() => {
				this._namedPipeServer.close();
				this._namedPipeServer = null;
				reject('timeout');
			}, 60 * 1000);

			this._namedPipeServer.on('connection', socket => {
				clearTimeout(handle);
				this._namedPipeServer.close();
				this._namedPipeServer = null;
				this._extensionHostConnection = socket;
				resolve(this._extensionHostConnection);
			});

		});
	}

	/**
	 * Start a server (`this._namedPipeServer`) that listens on a named pipe and return the named pipe name.
	 */
	private _tryListenOnPipe(): TPromise<string> {
		return new TPromise<string>((resolve, reject) => {
			const pipeName = generateRandomPipeName();

			this._namedPipeServer = net.createServer();
			this._namedPipeServer.on('error', reject);
			this._namedPipeServer.listen(pipeName, () => {
				this._namedPipeServer.removeListener('error', reject);
				resolve(pipeName);
			});
		});
	}
}

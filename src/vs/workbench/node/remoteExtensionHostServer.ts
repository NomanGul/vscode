/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import * as net from 'net';
import * as objects from 'vs/base/common/objects';
import * as cp from 'child_process';
import { generateRandomPipeName, Protocol } from 'vs/base/parts/ipc/node/ipc.net';
import { TPromise } from 'vs/base/common/winjs.base';
import URI from 'vs/base/common/uri';
import { fromNodeEventEmitter } from 'vs/base/common/event';
import { IRemoteConsoleLog } from 'vs/base/node/console';
import { IExtensionHostDebugParams } from 'vs/platform/environment/common/environment';

export class ExtensionHostConnection {

	private _rendererConnection: net.Socket;
	private _initialDataChunks: Buffer[];
	private _initialRendererConnectionListener: (data: Buffer) => void;

	private _namedPipeServer: net.Server;
	private _extensionHostProcess: cp.ChildProcess;
	private _extensionHostConnection: net.Socket;

	private _rendererClosed: boolean;
	private _resourcesCleaned: boolean;

	constructor(rendererConnection: net.Socket, protocol: Protocol) {
		const firstDataChunk = protocol.getBuffer();
		protocol.dispose();

		this._rendererConnection = rendererConnection;
		this._initialDataChunks = [];
		if (firstDataChunk && firstDataChunk.length > 0) {
			this._initialDataChunks.push(firstDataChunk);
		}
		this._initialRendererConnectionListener = (data: Buffer) => this._initialDataChunks.push(data);

		this._namedPipeServer = null;
		this._extensionHostProcess = null;
		this._extensionHostConnection = null;
		this._rendererClosed = false;
		this._resourcesCleaned = false;

		this._rendererConnection.on('data', this._initialRendererConnectionListener);
		this._rendererConnection.on('error', (error) => {
			console.error('Renderer connection recevied error');
			if (error) {
				console.error(error);
			}
			this._cleanResources();
		});

		this._rendererConnection.on('close', () => {
			console.log('Renderer connection got closed');
			this._rendererClosed = true;
			this._cleanResources();
		});
	}

	private _cleanResources(): void {
		if (this._resourcesCleaned) {
			return;
		}
		try {
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
		} finally {
			this._resourcesCleaned = true;
		}
	}

	public start(debugParams: IExtensionHostDebugParams | undefined): void {
		this._tryListenOnPipe().then(pipeName => {

			let execArgv = process.execArgv;
			if (debugParams && !(<any>process).pkg) {
				execArgv = [`--inspect${debugParams.break ? '-brk' : ''}=0.0.0.0:${debugParams.port}`].concat(execArgv);
			}
			const opts = {
				env: objects.mixin(objects.deepClone(process.env), {
					AMD_ENTRYPOINT: 'vs/workbench/node/extensionHostProcess',
					PIPE_LOGGING: 'true',
					VERBOSE_LOGGING: true,
					VSCODE_IPC_HOOK_EXTHOST: pipeName,
					VSCODE_HANDLES_UNCAUGHT_ERRORS: true,
					VSCODE_LOG_STACK: false
				}),
				execArgv,
				silent: true
			};

			// Run Extension Host as fork of current process
			this._extensionHostProcess = cp.fork(URI.parse(require.toUrl('bootstrap')).fsPath, ['--type=extensionHost'], opts);

			// Catch all output coming from the extension host process
			this._extensionHostProcess.stdout.setEncoding('utf8');
			this._extensionHostProcess.stderr.setEncoding('utf8');
			const onStdout = fromNodeEventEmitter<string>(this._extensionHostProcess.stdout, 'data');
			const onStderr = fromNodeEventEmitter<string>(this._extensionHostProcess.stderr, 'data');
			onStdout((e) => console.log(`EXTHOST-STDOUT::::::::` + e));
			onStderr((e) => console.log(`EXTHOST-STDERR::::::::` + e));


			// Support logging from extension host
			this._extensionHostProcess.on('message', msg => {
				if (msg && (<IRemoteConsoleLog>msg).type === '__$console') {
					console.log(`EXTHOST-LOG:::::`);
					console.log((<IRemoteConsoleLog>msg).arguments);
					// this._logExtensionHostMessage(<IRemoteConsoleLog>msg);
				}
			});

			// Lifecycle
			this._extensionHostProcess.on('error', (err) => {
				console.log(`EXTHOST: PROCESS ERRORD`);
				console.log(err);
			});

			this._extensionHostProcess.on('exit', (code: number, signal: string) => {
				console.log(`EXTHOST: PROCESS EXITED`);
				console.log(code);
				console.log(signal);
				if (!this._rendererClosed) {
					this._rendererConnection.end();
				}
				// this._onExtHostProcessExit(code, signal);
			});

			return this._tryExtHostHandshake();
		}).done(() => {
			console.log(`extension host connected to me!!!`);

			this._rendererConnection.removeListener('data', this._initialRendererConnectionListener);
			for (let i = 0, len = this._initialDataChunks.length; i < len; i++) {
				this._extensionHostConnection.write(this._initialDataChunks[i]);
			}
			this._extensionHostConnection.pipe(this._rendererConnection);
			this._rendererConnection.pipe(this._extensionHostConnection);

		}, (error) => {
			console.error('ExtensionHostConnection errored');
			if (error) {
				console.error(error);
			}
		});
	}

	private _tryExtHostHandshake(): TPromise<net.Socket> {

		return new TPromise<net.Socket>((resolve, reject) => {

			// Wait for the extension host to connect to our named pipe
			// and wrap the socket in the message passing protocol
			let handle = setTimeout(() => {
				if (this._namedPipeServer) {
					this._namedPipeServer.close();
					this._namedPipeServer = null;
				}
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
				this._namedPipeServer.on('error', (error) => {
					console.error('Named pipe server received error');
					if (error) {
						console.error(error);
					}
				});
				resolve(pipeName);
			});
		});
	}
}

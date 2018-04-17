/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import * as net from 'net';
import * as nls from 'vs/nls';
import * as http from 'http';
import * as objects from 'vs/base/common/objects';
import * as cp from 'child_process';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import pkg from 'vs/platform/node/package';
import { generateRandomPipeName } from 'vs/base/parts/ipc/node/ipc.net';
import { TPromise } from 'vs/base/common/winjs.base';
import URI from 'vs/base/common/uri';
import { fromNodeEventEmitter } from 'vs/base/common/event';
import { IRemoteConsoleLog } from 'vs/base/node/console';
import { ExtensionScanner, ExtensionScannerInput, ILog } from 'vs/workbench/services/extensions/node/extensionPoints';
import { IExtensionDescription } from 'vs/workbench/services/extensions/common/extensions';
import { toLocalISOString } from 'vs/base/common/date';

export interface IAgentScanExtensionsResponse {
	agentPid: number;
	agentAppRoot: string;
	agentAppSettingsHome: string;
	agentLogsPath: string;
	agentExtensionsFolder: string;
	extensions: IExtensionDescription[];
}

const REMOTE_DATA_FOLDER = path.join(os.homedir(), '.vscode-remote');
const EXTENSION_FOLDER = path.join(REMOTE_DATA_FOLDER, 'extensions');
const USER_DATA_FOLDER = path.join(REMOTE_DATA_FOLDER, 'data');
const LOGS_FOLDER = path.join(REMOTE_DATA_FOLDER, 'logs');
const APP_SETTINGS_HOME = path.join(USER_DATA_FOLDER, 'User');
const APP_ROOT = path.dirname(URI.parse(require.toUrl('')).fsPath);
const BUILTIN_EXTENSIONS_FOLDER_PATH = path.join(APP_ROOT, 'extensions');

let builtinExtensions = [];
process.argv.forEach((arg) => {
	if (/^--builtin-extensions=/.test(arg)) {
		arg = arg.substr('--builtin-extensions='.length);
		builtinExtensions = arg.split(',');
	}
});

[REMOTE_DATA_FOLDER, EXTENSION_FOLDER, USER_DATA_FOLDER, APP_SETTINGS_HOME, LOGS_FOLDER].forEach(f => {
	try {
		if (!fs.existsSync(f)) {
			fs.mkdirSync(f);
		}
	} catch (err) { console.error(err); }
});

console.log(`Remote configuration data at ${REMOTE_DATA_FOLDER}`);
console.log(`Remote extensions: ${fs.readdirSync(EXTENSION_FOLDER).join(', ')}`);

var ifaces = os.networkInterfaces();

Object.keys(ifaces).forEach(function (ifname) {
	ifaces[ifname].forEach(function (iface) {
		if (!iface.internal && iface.family === 'IPv4') {
			console.log(`IP Address: ${iface.address}`);
		}
	});
});


const DefaultSize = 2048;
const Colon = new Buffer(':', 'ascii')[0];

class MessageBuffer {

	private encoding: string;
	private index: number;
	private buffer: Buffer;

	constructor(encoding: string = 'utf8') {
		this.encoding = encoding;
		this.index = 0;
		this.buffer = new Buffer(DefaultSize);
	}

	public append(chunk: Buffer | string): void {
		var toAppend: Buffer = <Buffer>chunk;
		if (typeof chunk === 'string') {
			var str = chunk;
			var bufferLen = Buffer.byteLength(str, this.encoding);
			toAppend = new Buffer(bufferLen);
			toAppend.write(str, 0, bufferLen, this.encoding);
		}
		if (this.buffer.length - this.index >= toAppend.length) {
			toAppend.copy(this.buffer, this.index, 0, toAppend.length);
		} else {
			var newSize = (Math.ceil((this.index + toAppend.length) / DefaultSize) + 1) * DefaultSize;
			if (this.index === 0) {
				this.buffer = new Buffer(newSize);
				toAppend.copy(this.buffer, 0, 0, toAppend.length);
			} else {
				this.buffer = Buffer.concat([this.buffer.slice(0, this.index), toAppend], newSize);
			}
		}
		this.index += toAppend.length;
	}

	public tryReadLength(): number | undefined {
		let result: number | undefined = undefined;
		let current = 0;
		while (current < this.index && (this.buffer[current] !== Colon)) {
			current++;
		}
		// No : found
		if (current >= this.index) {
			return result;
		}
		result = Number(this.buffer.toString('ascii', 0, current));

		// Skip ':'
		let nextStart = current + 1;
		this.buffer = this.buffer.slice(nextStart);
		this.index = this.index - nextStart;
		return result;
	}

	public tryReadContent(length: number): string | undefined {
		if (this.index < length) {
			return undefined;
		}
		let result = this.buffer.toString(this.encoding, 0, length);
		let nextStart = length;
		this.buffer.copy(this.buffer, 0, nextStart);
		this.index = this.index - nextStart;
		return result;
	}

	public get numberOfBytes(): number {
		return this.index;
	}

	public get rest(): Buffer {
		return this.buffer;
	}
}

const extHostServer = net.createServer((connection) => {
	let buffer = new MessageBuffer('utf8');
	let length: number | undefined = undefined;
	const listener = (data) => {
		buffer.append(data);
		if (length === void 0) {
			length = buffer.tryReadLength();
			if (length !== void 0) {
				console.log(`Command length found: ${length}`);
			} else {
				console.log(`Still waiting for length header`);
			}
		}
		if (length !== void 0) {
			let message = buffer.tryReadContent(length);
			if (message !== void 0) {
				console.log(`Message found: ${message} with pending data: ${buffer.numberOfBytes}`);
				try {
					let json = JSON.parse(message);
					if (json.command === 'startExtensionHost') {
						console.log('Received extension host start command');
						connection.removeListener('data', listener);
						const con = new ExtensionHostConnection(connection, buffer.numberOfBytes > 0 ? buffer.rest : undefined);
						con.start();
						buffer = undefined;
						length = undefined;
					}
				} catch (error) {
					console.error('Error parsing message');
					console.error(error);
				}
			} else {
				console.log(`Still waiting for message`);
			}
		}
	};
	connection.on('data', listener);
});
extHostServer.on('error', (err) => {
	console.error('Extension host server received error');
	if (err) {
		console.error(err);
	}
});
extHostServer.listen(8000, () => {
	console.log('Extension Host Server listening on 8000');
});

const consoleLogger = new class implements ILog {
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

function scanBuiltinExtensions(): TPromise<IExtensionDescription[]> {
	return TPromise.join(
		builtinExtensions.map((extensionPath) => {
			const absoluteExtensionPath = path.join(BUILTIN_EXTENSIONS_FOLDER_PATH, extensionPath);
			return ExtensionScanner.scanExtension(
				pkg.version,
				consoleLogger,
				absoluteExtensionPath,
				true,
				{ devMode: true, locale: 'en', pseudo: false, translations: {} }// TODO@vs-remote
			);
		})
	);
}

function scanInstalledExtensions(): TPromise<IExtensionDescription[]> {
	const input = new ExtensionScannerInput(
		pkg.version,
		null,
		'en', // TODO@vs-remote
		true,
		EXTENSION_FOLDER,
		false,
		{}
	);

	return ExtensionScanner.scanExtensions(input, consoleLogger);
}

async function scanExtensions(): TPromise<IExtensionDescription[]> {

	return TPromise.join([
		scanBuiltinExtensions(),
		scanInstalledExtensions()
	]).then(([builtinExtensions, installedExtensions]) => {
		let result: { [extensionId: string]: IExtensionDescription; } = {};

		builtinExtensions.forEach((builtinExtension) => {
			result[builtinExtension.id] = builtinExtension;
		});

		installedExtensions.forEach((installedExtension) => {
			if (result.hasOwnProperty(installedExtension.id)) {
				console.warn(nls.localize('overwritingExtension', "Overwriting extension {0} with {1}.", result[installedExtension.id].extensionFolderPath, installedExtension.extensionFolderPath));
			}
			result[installedExtension.id] = installedExtension;
		});

		return Object.keys(result).map((extId) => result[extId]);
	});
}

const httpServer = http.createServer((request, response) => {
	console.log(`received a connection on 8001`);
	if (request.url === '/scan-extensions') {
		scanExtensions().then((extensions) => {
			response.writeHead(200);
			let r: IAgentScanExtensionsResponse = {
				agentPid: process.pid,
				agentAppRoot: APP_ROOT,
				agentAppSettingsHome: APP_SETTINGS_HOME,
				agentLogsPath: path.join(LOGS_FOLDER, toLocalISOString(new Date()).replace(/-|:|\.\d+Z$/g, '')),
				agentExtensionsFolder: EXTENSION_FOLDER,
				extensions: extensions
			};
			response.end(JSON.stringify(r));
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
	console.error('Control server received error');
	if (err) {
		console.error(err);
	}
});
httpServer.listen(8001, () => {
	console.log('Control server listening on 8001');
});

class ExtensionHostConnection {

	private _namedPipeServer: net.Server;
	private _extensionHostProcess: cp.ChildProcess;
	private _extensionHostConnection: net.Socket;

	private _rendererClosed: boolean;

	constructor(private _rendererConnection: net.Socket, private _firstDataChunk: Buffer) {
		this._namedPipeServer = null;
		this._extensionHostProcess = null;
		this._extensionHostConnection = null;
		this._rendererClosed = false;

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
				console.log(`PROCESS ERRORD`);
				console.log(err);
			});

			this._extensionHostProcess.on('exit', (code: number, signal: string) => {
				console.log(`PROCESS EXITED`);
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

			if (this._firstDataChunk) {
				this._extensionHostConnection.write(this._firstDataChunk);
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

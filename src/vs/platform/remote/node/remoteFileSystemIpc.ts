/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { TPromise } from 'vs/base/common/winjs.base';
import { IChannel, IMessagePassingProtocol } from 'vs/base/parts/ipc/node/ipc';
import URI from 'vs/base/common/uri';
import * as pfs from 'vs/base/node/pfs';
import * as net from 'net';
import { Client, Protocol } from 'vs/base/parts/ipc/node/ipc.net';
import { Event } from 'vs/base/common/event';
import { IExtensionHostDebugParams } from 'vs/platform/environment/common/environment';

export let USE_VSDA = false;

let signer: any;
if (USE_VSDA) {
	try {
		const vsda = <any>require.__$__nodeRequire('vsda');
		signer = new vsda.signer();
	} catch (e) {
	}
}

export const enum ConnectionType {
	Management = 1,
	ExtensionHost = 2,
}

export interface AuthRequest {
	type: 'auth';
	auth: string;
}

export interface SignRequest {
	type: 'sign';
	data: string;
}

export interface ConnectionTypeRequest {
	type: 'connectionType';
	signedData?: string;
	desiredConnectionType?: ConnectionType;
	args?: any;
}

export type HandshakeMessage = AuthRequest | SignRequest | ConnectionTypeRequest;

export const REMOTE_EXTENSIONS_FILE_SYSTEM_CHANNEL_NAME = 'remoteextensionsfilesystem';

export interface IRemoteExtensionsFileSystem {
	getFile(path: string): TPromise<string>;
}

export class RemoteExtensionsFileSystemImpl implements IRemoteExtensionsFileSystem {
	async getFile(path: string): TPromise<string> {
		// Ensure path has correct slashes
		path = URI.file(path).fsPath;
		const result = await pfs.readFile(path);
		return result.toString('base64');
	}
}

export interface IRemoteExtensionsFileSystemChannel extends IChannel {
	call(command: 'getFile', arg: any): TPromise<string>;
	call(command: string, arg?: any): TPromise<any>;
}

export class RemoteExtensionsFileSystemChannel implements IRemoteExtensionsFileSystemChannel {

	constructor(private service: IRemoteExtensionsFileSystem) { }

	call(command: string, arg?: any): TPromise<any> {
		switch (command) {
			case 'getFile': return this.service.getFile(arg);
		}

		throw new Error(`IPC Command ${command} not found`);
	}

	listen(event: string, arg: any): Event<any> {
		throw new Error('Not implemented');
	}
}

export class RemoteExtensionsFileSystemChannelClient implements IRemoteExtensionsFileSystem {

	_serviceBrand: any;

	constructor(private channel: IRemoteExtensionsFileSystemChannel) { }

	getFile(path: string): TPromise<string> {
		return this.channel.call('getFile', path);
	}
}

function connectToRemoteExtensionHostAgent(host: string, port: number, connectionType: ConnectionType, args?: any): TPromise<Protocol> {
	return new TPromise<Protocol>((c, e) => {
		const socket = net.createConnection({ host: host, port: port }, () => {
			socket.removeListener('error', e);
			c(new Protocol(socket));
		});
		socket.once('error', e);
	}).then((protocol) => {

		return new TPromise<Protocol>((c, e) => {

			const messageRegistration = protocol.onMessage(raw => {
				const msg = <HandshakeMessage>JSON.parse(raw.toString());
				// Stop listening for further events
				messageRegistration.dispose();

				if (msg.type === 'sign') {

					let signed = msg.data;
					if (USE_VSDA) {
						try {
							if (signer) {
								signed = signer.sign(msg.data);
							}
						} catch (e) {
						}
					} else {
						// some fake signing
						signed = msg.data.toUpperCase();
					}

					const connTypeRequest: ConnectionTypeRequest = {
						type: 'connectionType',
						signedData: signed,
						desiredConnectionType: connectionType
					};
					if (args) {
						connTypeRequest.args = args;
					}
					protocol.send(Buffer.from(JSON.stringify(connTypeRequest)));

					c(protocol);
				} else {
					e(new Error('handshake error'));
				}
			});

			setTimeout(_ => {
				e(new Error('handshake timeout'));
			}, 2000);

			// TODO@vs-remote: use real nonce here
			const authRequest: AuthRequest = {
				type: 'auth',
				auth: '00000000000000000000'
			};
			protocol.send(Buffer.from(JSON.stringify(authRequest)));
		});
	});
}

export function connectToRemoteExtensionHostManagement(host: string, port: number, clientId: string): TPromise<Client> {
	return connectToRemoteExtensionHostAgent(host, port, ConnectionType.Management).then((protocol) => {
		return new Client(protocol, clientId);
	});
}

export interface IRemoteExtensionHostConnectionResult {
	protocol: IMessagePassingProtocol;
	debugPort?: number;
}

export function connectToRemoteExtensionHostServer(host: string, port: number, debugArguments: IExtensionHostDebugParams): TPromise<IRemoteExtensionHostConnectionResult> {
	return connectToRemoteExtensionHostAgent(host, port, ConnectionType.ExtensionHost, debugArguments).then(protocol => {
		return new TPromise<IRemoteExtensionHostConnectionResult>((c, e) => {
			const registration = protocol.onMessage(raw => {
				registration.dispose();
				const msg = JSON.parse(raw.toString());
				const debugPort = msg && msg.debugPort;
				c({ protocol, debugPort });
			});
		});
	});
}

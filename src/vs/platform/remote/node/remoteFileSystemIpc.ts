/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { TPromise } from 'vs/base/common/winjs.base';
import { IChannel, IMessagePassingProtocol } from 'vs/base/parts/ipc/common/ipc';
import URI from 'vs/base/common/uri';
import * as pfs from 'vs/base/node/pfs';
import * as net from 'net';
import { Client, Protocol } from 'vs/base/parts/ipc/node/ipc.net';
import { Event } from 'vs/base/common/event';

export const enum ConnectionType {
	Management = 1,
	ExtensionHost = 2,
}

export interface ConnectionTypeSelectionMessage {
	auth: string;
	desiredConnectionType: ConnectionType;
}

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

function connectToRemoteExtensionHostAgent(host: string, port: number, connectionType: ConnectionType): TPromise<Protocol> {
	return new TPromise<Protocol>((c, e) => {
		const socket = net.createConnection({ host: host, port: port }, () => {
			socket.removeListener('error', e);
			c(new Protocol(socket));
		});
		socket.once('error', e);
	}).then((protocol) => {
		// TODO@vs-remote: use real nonce here
		const msg: ConnectionTypeSelectionMessage = {
			auth: '00000000000000000000',
			desiredConnectionType: connectionType
		};
		protocol.send(msg);
		return protocol;
	});
}

export function connectToRemoteExtensionHostManagement(host: string, port: number, clientId: string): TPromise<Client> {
	return connectToRemoteExtensionHostAgent(host, port, ConnectionType.Management).then((protocol) => {
		return new Client(protocol, clientId);
	});
}

export function connectToRemoteExtensionHostServer(host: string, port: number): TPromise<IMessagePassingProtocol> {
	return connectToRemoteExtensionHostAgent(host, port, ConnectionType.ExtensionHost);
}

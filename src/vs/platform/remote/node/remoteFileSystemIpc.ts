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

export const REMOTE_SOCKET_HANDSHAKE_MANAGEMENT = 1;
export const REMOTE_SOCKET_HANDSHAKE_EXT_HOST = 2;
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

// TODO(joao): Verify listen and T type
export interface IRemoteExtensionsFileSystemChannel extends IChannel {
	call<String>(command: 'getFile', arg: any): TPromise<String>;
	listen<String>(event: 'getFile', arg: any): Event<String>;
}

export class RemoteExtensionsFileSystemChannel implements IRemoteExtensionsFileSystemChannel {

	constructor(private service: IRemoteExtensionsFileSystem) { }

	call(command: string, arg?: any): TPromise<any> {
		switch (command) {
			case 'getFile': return this.service.getFile(arg);
		}
		return undefined;
	}

	// TODO(joao): Do impl
	listen(event: 'getFile', arg: any): Event<any> {
		throw new Error('NYI');
	}
}

export class RemoteExtensionsFileSystemChannelClient implements IRemoteExtensionsFileSystem {

	_serviceBrand: any;

	constructor(private channel: IRemoteExtensionsFileSystemChannel) { }

	getFile(path: string): TPromise<string> {
		return this.channel.call('getFile', path);
	}

}

export function connectToRemoteExtensionHostManagement(host: string, port: number, clientId: string): TPromise<Client> {
	return new TPromise<Client>((c, e) => {
		const socket = net.createConnection({ host: host, port: port }, () => {
			socket.removeListener('error', e);
			const chunk = new Buffer(1);
			chunk[0] = REMOTE_SOCKET_HANDSHAKE_MANAGEMENT;
			socket.write(chunk);
			c(new Client(socket, clientId));
		});
		socket.once('error', e);
	});
}

export function connectToRemoteExtensionHostServer(host: string, port: number): TPromise<IMessagePassingProtocol> {
	return new TPromise<IMessagePassingProtocol>((resolve, reject) => {
		const socket = net.createConnection({ host, port }, () => {
			socket.removeListener('error', reject);

			const chunk = new Buffer(1);
			chunk[0] = REMOTE_SOCKET_HANDSHAKE_EXT_HOST;
			socket.write(chunk);

			resolve(new Protocol(socket));
		});
		socket.once('error', reject);
	});
}

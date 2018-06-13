/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { TPromise } from 'vs/base/common/winjs.base';
import { IChannel } from 'vs/base/parts/ipc/common/ipc';
import URI from 'vs/base/common/uri';
import * as pfs from 'vs/base/node/pfs';

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
}

export class RemoteExtensionsFileSystemChannel implements IRemoteExtensionsFileSystemChannel {

	constructor(private service: IRemoteExtensionsFileSystem) { }

	call(command: string, arg?: any): TPromise<any> {
		switch (command) {
			case 'getFile': return this.service.getFile(arg);
		}
		return undefined;
	}
}

export class RemoteExtensionsFileSystemChannelClient implements IRemoteExtensionsFileSystem {

	_serviceBrand: any;

	constructor(private channel: IRemoteExtensionsFileSystemChannel) { }

	getFile(path: string): TPromise<string> {
		return this.channel.call('getFile', path);
	}

}
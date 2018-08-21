/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { TPromise } from 'vs/base/common/winjs.base';
import { IChannel } from 'vs/base/parts/ipc/node/ipc';
import { IRemoteExtensionsEnvironmentData, IRemoteExtensionsEnvironment } from 'vs/workbench/services/extensions/node/remoteExtensionsService';
import { Event } from 'vs/base/common/event';

export interface IRemoteExtensionsEnvironmentChannel extends IChannel {
	call(command: 'getRemoteExtensionInformation', arg: any): TPromise<IRemoteExtensionsEnvironmentData>;
	call(command: string, arg?: any): TPromise<any>;
}

export class RemoteExtensionsEnvironmentChannel implements IRemoteExtensionsEnvironmentChannel {

	constructor(private service: IRemoteExtensionsEnvironment) { }

	call(command: string, arg?: any): TPromise<any> {
		switch (command) {
			case 'getRemoteExtensionInformation': return this.service.getRemoteExtensionInformation(arg);
		}

		throw new Error(`IPC Command ${command} not found`);
	}

	listen(event: string, arg: any): Event<any> {
		throw new Error('Not implemented');
	}
}

export class RemoteExtensionsEnvironmentChannelClient implements IRemoteExtensionsEnvironment {

	_serviceBrand: any;

	constructor(private channel: IRemoteExtensionsEnvironmentChannel) { }

	getRemoteExtensionInformation(remoteAuthority: string): TPromise<IRemoteExtensionsEnvironmentData> {
		return this.channel.call('getRemoteExtensionInformation', remoteAuthority);
	}
}
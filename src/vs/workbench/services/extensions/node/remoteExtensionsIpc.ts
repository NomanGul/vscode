/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { TPromise } from 'vs/base/common/winjs.base';
import { IChannel } from 'vs/base/parts/ipc/common/ipc';
import { IRemoteExtensionsEnvironmentData, IRemoteExtensionsEnvironment } from 'vs/workbench/services/extensions/common/remoteExtensionsService';
import { Event } from 'vs/base/common/event';

export interface IRemoteExtensionsEnvironmentChannel extends IChannel {
	call<IRemoteExtensionsEnvironmentData>(command: 'getRemoteExtensionInformation', arg: any): TPromise<IRemoteExtensionsEnvironmentData>;
	// TODO(joao): You added this to ipc.ts in 0f851d0, verify it's right
	listen<IRemoteExtensionsEnvironmentData>(event: 'getRemoteExtensionInformation', arg: any): Event<IRemoteExtensionsEnvironmentData>;
}

export class RemoteExtensionsEnvironmentChannel implements IRemoteExtensionsEnvironmentChannel {

	constructor(private service: IRemoteExtensionsEnvironment) { }

	call(command: string, arg?: any): TPromise<any> {
		switch (command) {
			case 'getRemoteExtensionInformation': return this.service.getRemoteExtensionInformation(arg);
		}
		return undefined;
	}

	// TODO(joao): Do impl
	listen(event: 'getRemoteExtensionInformation', arg: any): Event<any> {
		throw new Error('NYI');
	}

}

export class RemoteExtensionsEnvironmentChannelClient implements IRemoteExtensionsEnvironment {

	_serviceBrand: any;

	constructor(private channel: IRemoteExtensionsEnvironmentChannel) { }

	getRemoteExtensionInformation(remoteAuthority: string): TPromise<IRemoteExtensionsEnvironmentData> {
		return this.channel.call('getRemoteExtensionInformation', remoteAuthority);
	}

}
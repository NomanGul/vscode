/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IExtensionDescription } from 'vs/workbench/services/extensions/common/extensions';
import { TPromise } from 'vs/base/common/winjs.base';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IChannel } from 'vs/base/parts/ipc/node/ipc';

export const IRemoteExtensionsService = createDecorator<IRemoteExtensionsService>('remoteExtensionsService');

export interface IRemoteExtensionsEnvironmentData {
	agentPid: number;
	agentAppRoot: string;
	agentAppSettingsHome: string;
	agentLogsPath: string;
	agentExtensionsPath: string;
	extensions: IExtensionDescription[];
}

export interface IRemoteExtensionsEnvironment {
	getRemoteExtensionInformation(remoteAuthority: string, extensionDevelopmentPath?: string): TPromise<IRemoteExtensionsEnvironmentData>;
}

export interface IRemoteExtensionsService {
	_serviceBrand: any;

	getRemoteConnection(): IRemoteHostConnection;
}

export interface IRemoteHostConnection {
	readonly remoteAuthority: string;
	getChannel<T extends IChannel>(channelName: string): T;
	registerChannel<T extends IChannel>(channelName: string, channel: T);
}

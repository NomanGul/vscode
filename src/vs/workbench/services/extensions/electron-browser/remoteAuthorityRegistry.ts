/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { TPromise, TValueCallback } from 'vs/base/common/winjs.base';
import { ipcRenderer as ipc } from 'electron';

export class ResolvedAuthority {
	constructor(
		public readonly authority: string,
		public readonly host: string,
		public readonly port: number
	) {
	}
}

export class RemoteAuthorityRegistryImpl {

	private _resolveAuthorityCache: { [authority: string]: TPromise<ResolvedAuthority>; };
	private _awaitingResolveRequests: { [authority: string]: TValueCallback<ResolvedAuthority>; };

	constructor() {
		this._resolveAuthorityCache = Object.create(null);
		this._awaitingResolveRequests = Object.create(null);
		ipc.on('vscode:resolveAuthorityReply', (event: any, data: ResolvedAuthority) => {
			const callback = this._awaitingResolveRequests[data.authority];
			if (callback) {
				callback(data);
			}
		});
	}

	public resolveAuthority(authority: string): TPromise<ResolvedAuthority> {
		if (!this._resolveAuthorityCache[authority]) {
			this._resolveAuthorityCache[authority] = this._resolveAuthority(authority);
		}
		return this._resolveAuthorityCache[authority];
	}

	private _resolveAuthority(authority: string): TPromise<ResolvedAuthority> {
		// TODO@vs-remote: Do not send message if the authority is already resolved to a hostname/IP address
		return new TPromise<ResolvedAuthority>((c, e) => {
			this._awaitingResolveRequests[authority] = c;
			ipc.send('vscode:resolveAuthorityRequest', authority);
		});
	}
}
export const RemoteAuthorityRegistry = new RemoteAuthorityRegistryImpl();

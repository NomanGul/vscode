/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { TPromise, TValueCallback, ErrorCallback } from 'vs/base/common/winjs.base';
import { ipcRenderer as ipc } from 'electron';

export class ResolvedAuthority {
	constructor(
		public readonly authority: string,
		public readonly host: string,
		public readonly port: number
	) {
	}
}

export type IResolveAuthorityReply = { type: 'ok'; authority: string; host: string; port: number; } | { type: 'err'; authority: string; error: any; };

export class RemoteAuthorityRegistryImpl {

	private _resolveAuthorityCache: { [authority: string]: TPromise<ResolvedAuthority>; };
	private _awaitingResolveRequestsOK: { [authority: string]: TValueCallback<ResolvedAuthority>; };
	private _awaitingResolveRequestsErr: { [authority: string]: ErrorCallback; };

	constructor() {
		this._resolveAuthorityCache = Object.create(null);
		this._awaitingResolveRequestsOK = Object.create(null);
		this._awaitingResolveRequestsErr = Object.create(null);
		ipc.on('vscode:resolveAuthorityReply', (event: any, data: IResolveAuthorityReply) => {
			if (data.type === 'err') {
				if (this._awaitingResolveRequestsErr[data.authority]) {
					this._awaitingResolveRequestsErr[data.authority](data.error);
				}
			} else {
				if (this._awaitingResolveRequestsOK[data.authority]) {
					this._awaitingResolveRequestsOK[data.authority](new ResolvedAuthority(data.authority, data.host, data.port));
				}
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
		if (authority.indexOf('+') >= 0) {
			// This is a special kind of authority that needs to be resolved by the main process
			return new TPromise<ResolvedAuthority>((c, e) => {
				this._awaitingResolveRequestsOK[authority] = c;
				this._awaitingResolveRequestsErr[authority] = e;
				ipc.send('vscode:resolveAuthorityRequest', authority);
			});
		} else {
			const [host, strPort] = authority.split(':');
			const port = parseInt(strPort, 10);
			return TPromise.as(new ResolvedAuthority(authority, host, port));
		}
	}
}
export const RemoteAuthorityRegistry = new RemoteAuthorityRegistryImpl();

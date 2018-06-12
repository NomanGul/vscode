/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import * as platform from 'vs/base/common/platform';
import { IURITransformer } from 'vs/workbench/services/extensions/node/rpcProtocol';
import URI, { UriComponents } from 'vs/base/common/uri';

export function createRemoteURITransformer(remoteAuthority: string): IURITransformer {
	return new class implements IURITransformer {
		transformIncoming(uri: UriComponents): UriComponents {
			// TODO@vs-remote
			if (uri.scheme === 'vscode-remote') {
				const r = URI.file(uri.path);
				// console.log(`INCOMING: ${URI.revive(uri)} ====> ${r}`);
				return <UriComponents>r.toJSON();
			} else if (uri.scheme === 'file') {
				const r = URI.from({ scheme: 'vscode-local', authority: '', path: uri.path.replace(/\\/g, '/') });
				// console.log(`INCOMING: ${URI.revive(uri)} ====> ${r}`);
				return r;
			}
			return uri;
		}
		transformOutgoing(uri: URI): URI {
			// TODO@vs-remote
			if (uri.scheme === 'file') {
				const r = URI.from({ scheme: 'vscode-remote', authority: remoteAuthority, path: (platform.isWindows ? '/' : '') + uri.fsPath.replace(/\\/g, '/') });
				// console.log(`OUTGOING: ${uri} ====> ${r}`);
				return r;
			} else if (uri.scheme === 'vscode-local') {
				const r = URI.file(uri.path);
				// console.log(`OUTGOING: ${URI.revive(uri)} ====> ${r}`);
				return r;
			}
			return uri;
		}
	};
}

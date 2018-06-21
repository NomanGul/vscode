/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

(function () {
	const path = require('path');
	const Module = require('module');
	const os = require('os');
	const NODE_MODULES_PATH = path.join(__dirname, '../node_modules');
	const ALTERNATIVE_NODE_MODULES_PATH = path.join(os.homedir(), '.vscode-remote', 'node_modules');

	const exception = {
		'iconv-lite': true,
		'semver': true,
		'yauzl': true,
		'minimist': true
	};

	const originalResolveLookupPaths = Module._resolveLookupPaths;
	Module._resolveLookupPaths = function (request, parent, newReturn) {
		const result = originalResolveLookupPaths(request, parent, newReturn);

		const paths = newReturn ? result : result[1];
		for (let i = 0, len = paths.length; i < len; i++) {
			if (paths[i] === NODE_MODULES_PATH && (exception[request] === true)) {
				paths.splice(i, 0, ALTERNATIVE_NODE_MODULES_PATH);
				break;
			}
		}
		return result;
	};
})();

require('./bootstrap-amd').bootstrap('vs/workbench/node/remoteExtensionHostAgent');

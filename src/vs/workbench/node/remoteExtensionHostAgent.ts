/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import URI from 'vs/base/common/uri';
import { deepClone } from 'vs/base/common/objects';
import { ParsedArgs } from 'vs/platform/environment/common/environment';
import { RemoteExtensionManagementServer } from 'vs/workbench/node/remoteExtensionManagement';
import { RemoteExtensionHostServer } from 'vs/workbench/node/remoteExtensionHost';
import { EnvironmentService } from 'vs/platform/environment/node/environmentService';

const ifaces = os.networkInterfaces();

Object.keys(ifaces).forEach(function (ifname) {
	ifaces[ifname].forEach(function (iface) {
		if (!iface.internal && iface.family === 'IPv4') {
			console.log(`IP Address: ${iface.address}`);
		}
	});
});

const args: ParsedArgs = deepClone(process.env);

const REMOTE_DATA_FOLDER = path.join(os.homedir(), '.vscode-remote');
const USER_DATA_PATH = path.join(REMOTE_DATA_FOLDER, 'data');
const APP_SETTINGS_HOME = path.join(USER_DATA_PATH, 'User');
const LOGS_FOLDER = path.join(USER_DATA_PATH, 'logs');
if (!args['user-data-dir']) {
	args['user-data-dir'] = USER_DATA_PATH;
}

const APP_ROOT = path.dirname(URI.parse(require.toUrl('')).fsPath);
const BUILTIN_EXTENSIONS_FOLDER_PATH = path.join(APP_ROOT, 'extensions');
if (!args['builtin-extensions-dir']) {
	args['builtin-extensions-dir'] = BUILTIN_EXTENSIONS_FOLDER_PATH;
}
args['builtin-extensions'] = [];
process.argv.forEach((arg) => {
	if (/^--builtin-extensions=/.test(arg)) {
		arg = arg.substr('--builtin-extensions='.length);
		args['builtin-extensions'] = arg.split(',');
	}
});

const EXTENSIONS_PATH = path.join(REMOTE_DATA_FOLDER, 'extensions');
if (!args['extensions-dir']) {
	args['extensions-dir'] = EXTENSIONS_PATH;
}

[REMOTE_DATA_FOLDER, EXTENSIONS_PATH, USER_DATA_PATH, APP_SETTINGS_HOME, LOGS_FOLDER].forEach(f => {
	try {
		if (!fs.existsSync(f)) {
			fs.mkdirSync(f);
		}
	} catch (err) { console.error(err); }
});

console.log(`Remote configuration data at ${REMOTE_DATA_FOLDER}`);
console.log(`Remote extensions: ${fs.readdirSync(EXTENSIONS_PATH).join(', ')}`);

new RemoteExtensionManagementServer(new EnvironmentService(args, process.execPath)).start(8001);
new RemoteExtensionHostServer().start(8000);
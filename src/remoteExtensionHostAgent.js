/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

if (process.argv[2] === '--exec') {
	process.argv.splice(1, 2);
	require(process.argv[1]);
} else {
	require('./bootstrap-amd').bootstrap('vs/workbench/node/remoteExtensionHostAgent');
}

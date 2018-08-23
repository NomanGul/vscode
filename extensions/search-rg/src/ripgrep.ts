/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { join, basename } from 'path';
import { rgPath as rgPathModule } from 'vscode-ripgrep';

const rgPath = (<any>process).pkg ? join(process.execPath, '..', basename(rgPathModule)) : rgPathModule;

export { rgPath };
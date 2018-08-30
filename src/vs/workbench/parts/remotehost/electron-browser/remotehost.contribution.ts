/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import * as nls from 'vs/nls';

import { Registry } from 'vs/platform/registry/common/platform';
import { StatusbarAlignment, IStatusbarRegistry, Extensions, StatusbarItemDescriptor, IStatusbarItem } from 'vs/workbench/browser/parts/statusbar/statusbar';
import { Themable } from 'vs/workbench/common/theme';
import { IDisposable } from 'vscode-xterm';

import * as Dom from 'vs/base/browser/dom';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { IRemoteExtensionsService } from 'vs/workbench/services/extensions/node/remoteExtensionsService';
import { toDisposable, dispose } from 'vs/base/common/lifecycle';
import { OcticonLabel } from 'vs/base/browser/ui/octiconLabel/octiconLabel';

class RemoteHostStatusBarItem extends Themable implements IStatusbarItem {

	constructor(
		@IThemeService themeService: IThemeService,
		@IRemoteExtensionsService private remoteHostService: IRemoteExtensionsService
	) {
		super(themeService);
	}

	public render(container: HTMLElement): IDisposable {
		let callOnDispose: IDisposable[] = [];

		const element = document.createElement('div');

		let label = new OcticonLabel(element);
		label.title = nls.localize('remoteTotle', "Connected to remote host");
		label.text = `$(file-symlink-directory) WSL`;

		if (!this.remoteHostService.getRemoteConnection()) {
			Dom.hide(element);
		}

		container.appendChild(element);

		return toDisposable(() => {
			callOnDispose = dispose(callOnDispose);
		});
	}
}


// Register Statusbar item
Registry.as<IStatusbarRegistry>(Extensions.Statusbar).registerStatusbarItem(new StatusbarItemDescriptor(
	RemoteHostStatusBarItem,
	StatusbarAlignment.LEFT,
	Number.MAX_VALUE /* first entry */
));
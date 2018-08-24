/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Registry } from 'vs/platform/registry/common/platform';
import { LifecyclePhase } from 'vs/platform/lifecycle/common/lifecycle';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { FileDialogContext } from 'vs/platform/workbench/common/contextkeys';
import { IWorkbenchContribution, IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions } from 'vs/workbench/common/contributions';
import { IRemoteExtensionsService } from 'vs/workbench/services/extensions/node/remoteExtensionsService';

class FileDialogContribution implements IWorkbenchContribution {

	constructor(@IContextKeyService readonly contextKeyService: IContextKeyService,
		@IRemoteExtensionsService readonly extensionsService: IRemoteExtensionsService
	) {
		if (extensionsService.getRemoteConnection()) {
			FileDialogContext.bindTo(contextKeyService).set('remote');
		}
	}
}

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(FileDialogContribution, LifecyclePhase.Starting);

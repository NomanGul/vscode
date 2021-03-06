/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import * as nls from 'vs/nls';
import { URI } from 'vs/base/common/uri';
import { TPromise } from 'vs/base/common/winjs.base';
import { onUnexpectedError } from 'vs/base/common/errors';
import { ThrottledDelayer } from 'vs/base/common/async';
import { QuickOpenHandler, EditorQuickOpenEntry } from 'vs/workbench/browser/quickopen';
import { QuickOpenModel, QuickOpenEntry, compareEntries } from 'vs/base/parts/quickopen/browser/quickOpenModel';
import { IAutoFocus, Mode, IEntryRunContext } from 'vs/base/parts/quickopen/common/quickOpen';
import * as filters from 'vs/base/common/filters';
import * as strings from 'vs/base/common/strings';
import { Range } from 'vs/editor/common/core/range';
import { EditorInput, IWorkbenchEditorConfiguration } from 'vs/workbench/common/editor';
import { symbolKindToCssClass } from 'vs/editor/common/modes';
import { IResourceInput } from 'vs/platform/editor/common/editor';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IWorkspaceSymbolProvider, getWorkspaceSymbols, IWorkspaceSymbol } from 'vs/workbench/parts/search/common/search';
import { basename } from 'vs/base/common/paths';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { ILabelService } from 'vs/platform/label/common/label';

class SymbolEntry extends EditorQuickOpenEntry {

	private _bearingResolve: TPromise<this>;

	constructor(
		private _bearing: IWorkspaceSymbol,
		private _provider: IWorkspaceSymbolProvider,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IEditorService editorService: IEditorService,
		@ILabelService private _labelService: ILabelService
	) {
		super(editorService);
	}

	public getLabel(): string {
		return this._bearing.name;
	}

	public getAriaLabel(): string {
		return nls.localize('entryAriaLabel', "{0}, symbols picker", this.getLabel());
	}

	public getDescription(): string {
		const containerName = this._bearing.containerName;
		if (this._bearing.location.uri) {
			if (containerName) {
				return `${containerName} — ${basename(this._bearing.location.uri.fsPath)}`;
			} else {
				return this._labelService.getUriLabel(this._bearing.location.uri, true);
			}
		}
		return containerName;
	}

	public getIcon(): string {
		return symbolKindToCssClass(this._bearing.kind);
	}

	public getResource(): URI {
		return this._bearing.location.uri;
	}

	public run(mode: Mode, context: IEntryRunContext): boolean {

		// resolve this type bearing if neccessary
		if (!this._bearingResolve
			&& typeof this._provider.resolveWorkspaceSymbol === 'function'
			&& !this._bearing.location.range
		) {

			this._bearingResolve = this._provider.resolveWorkspaceSymbol(this._bearing).then(result => {
				this._bearing = result || this._bearing;
				return this;
			}, onUnexpectedError);
		}

		TPromise.as(this._bearingResolve)
			.then(_ => super.run(mode, context))
			.then(undefined, onUnexpectedError);

		// hide if OPEN
		return mode === Mode.OPEN;
	}

	public getInput(): IResourceInput | EditorInput {
		let input: IResourceInput = {
			resource: this._bearing.location.uri,
			options: {
				pinned: !this._configurationService.getValue<IWorkbenchEditorConfiguration>().workbench.editor.enablePreviewFromQuickOpen
			}
		};

		if (this._bearing.location.range) {
			input.options.selection = Range.collapseToStart(this._bearing.location.range);
		}

		return input;
	}

	public static compare(elementA: SymbolEntry, elementB: SymbolEntry, searchValue: string): number {

		// Sort by Type if name is identical
		const elementAName = elementA.getLabel().toLowerCase();
		const elementBName = elementB.getLabel().toLowerCase();
		if (elementAName === elementBName) {
			let elementAType = symbolKindToCssClass(elementA._bearing.kind);
			let elementBType = symbolKindToCssClass(elementB._bearing.kind);
			return elementAType.localeCompare(elementBType);
		}

		return compareEntries(elementA, elementB, searchValue);
	}
}

export interface IOpenSymbolOptions {
	skipSorting: boolean;
	skipLocalSymbols: boolean;
	skipDelay: boolean;
}

export class OpenSymbolHandler extends QuickOpenHandler {

	public static readonly ID = 'workbench.picker.symbols';

	private static readonly SEARCH_DELAY = 500; // This delay accommodates for the user typing a word and then stops typing to start searching

	private delayer: ThrottledDelayer<QuickOpenEntry[]>;
	private options: IOpenSymbolOptions;

	constructor(@IInstantiationService private instantiationService: IInstantiationService) {
		super();

		this.delayer = new ThrottledDelayer<QuickOpenEntry[]>(OpenSymbolHandler.SEARCH_DELAY);
		this.options = Object.create(null);
	}

	public setOptions(options: IOpenSymbolOptions) {
		this.options = options;
	}

	public canRun(): boolean | string {
		return true;
	}

	public getResults(searchValue: string): TPromise<QuickOpenModel> {
		searchValue = searchValue.trim();

		let promise: TPromise<QuickOpenEntry[]>;
		if (!this.options.skipDelay) {
			promise = this.delayer.trigger(() => this.doGetResults(searchValue)); // Run search with delay as needed
		} else {
			promise = this.doGetResults(searchValue);
		}

		return promise.then(e => new QuickOpenModel(e));
	}

	private doGetResults(searchValue: string): TPromise<SymbolEntry[]> {
		return getWorkspaceSymbols(searchValue).then(tuples => {
			const result: SymbolEntry[] = [];
			for (let tuple of tuples) {
				const [provider, bearings] = tuple;
				this.fillInSymbolEntries(result, provider, bearings, searchValue);
			}

			// Sort (Standalone only)
			if (!this.options.skipSorting) {
				searchValue = searchValue ? strings.stripWildcards(searchValue.toLowerCase()) : searchValue;
				return result.sort((a, b) => SymbolEntry.compare(a, b, searchValue));
			} else {
				return result;
			}
		});
	}

	private fillInSymbolEntries(bucket: SymbolEntry[], provider: IWorkspaceSymbolProvider, types: IWorkspaceSymbol[], searchValue: string): void {

		// Convert to Entries
		for (let element of types) {
			if (this.options.skipLocalSymbols && !!element.containerName) {
				continue; // ignore local symbols if we are told so
			}

			const entry = this.instantiationService.createInstance(SymbolEntry, element, provider);
			entry.setHighlights(filters.matchesFuzzy(searchValue, entry.getLabel()));
			bucket.push(entry);
		}
	}

	public getGroupLabel(): string {
		return nls.localize('symbols', "symbol results");
	}

	public getEmptyLabel(searchString: string): string {
		if (searchString.length > 0) {
			return nls.localize('noSymbolsMatching', "No symbols matching");
		}
		return nls.localize('noSymbolsWithoutInput', "Type to search for symbols");
	}

	public getAutoFocus(searchValue: string): IAutoFocus {
		return {
			autoFocusFirstEntry: true,
			autoFocusPrefixMatch: searchValue.trim()
		};
	}
}

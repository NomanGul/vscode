/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import { asWinJsPromise } from 'vs/base/common/async';
import { TPromise } from 'vs/base/common/winjs.base';
import { IPatternInfo, IFolderQuery, IRawSearchQuery } from 'vs/platform/search/common/search';
import * as vscode from 'vscode';
import { ExtHostSearchShape, IMainContext, MainContext, MainThreadSearchShape } from './extHost.protocol';
import URI, { UriComponents } from 'vs/base/common/uri';

export class ExtHostSearch implements ExtHostSearchShape {

	private readonly _proxy: MainThreadSearchShape;
	private readonly _searchProvider = new Map<number, vscode.SearchProvider>();
	private _handlePool: number = 0;

	constructor(mainContext: IMainContext) {
		this._proxy = mainContext.getProxy(MainContext.MainThreadSearch);
	}

	registerSearchProvider(scheme: string, provider: vscode.SearchProvider) {
		const handle = this._handlePool++;
		this._searchProvider.set(handle, provider);
		this._proxy.$registerSearchProvider(handle, scheme);
		return {
			dispose: () => {
				this._searchProvider.delete(handle);
				this._proxy.$unregisterProvider(handle);
			}
		};
	}

	$provideFileSearchResults(handle: number, session: number, query: string): TPromise<void> {
		const provider = this._searchProvider.get(handle);
		if (!provider.provideFileSearchResults) {
			return TPromise.as(undefined);
		}
		const progress = {
			report: (uri) => {
				this._proxy.$handleFindMatch(handle, session, uri);
			}
		};
		return asWinJsPromise(token => provider.provideFileSearchResults(query, progress, token));
	}

	$provideTextSearchResults(handle: number, session: number, pattern: IPatternInfo, query: IRawSearchQuery): TPromise<void> {
		return TPromise.join(
			query.folderQueries.map(fq => this.provideTextSearchResultsForFolder(handle, session, pattern, query, fq))
		).then(
			() => { },
			(err: Error[]) => {
				return TPromise.wrapError(err[0]);
			});
	}

	private provideTextSearchResultsForFolder(handle: number, session: number, pattern: IPatternInfo, query: IRawSearchQuery, folderQuery: IFolderQuery<UriComponents>): TPromise<void> {
		const provider = this._searchProvider.get(handle);
		if (!provider.provideTextSearchResults) {
			return TPromise.as(undefined);
		}

		const includes: string[] = query.includePattern ? Object.keys(query.includePattern) : [];
		if (folderQuery.includePattern) {
			includes.push(...Object.keys(folderQuery.includePattern));
		}

		const excludes: string[] = query.excludePattern ? Object.keys(query.excludePattern) : [];
		if (folderQuery.excludePattern) {
			excludes.push(...Object.keys(folderQuery.excludePattern));
		}

		const searchOptions: vscode.TextSearchOptions = {
			folder: URI.from(folderQuery.folder),
			excludes,
			includes,
			disregardIgnoreFiles: query.disregardIgnoreFiles,
			ignoreSymlinks: query.ignoreSymlinks,
			encoding: query.fileEncoding
		};

		const progress = {
			report: (data: vscode.TextSearchResult) => {
				this._proxy.$handleFindMatch(handle, session, [data.uri, {
					lineNumber: data.range.start.line,
					preview: data.preview.leading + data.preview.matching + data.preview.trailing,
					offsetAndLengths: [[data.preview.leading.length, data.preview.matching.length]]
				}]);
			}
		};
		return asWinJsPromise(token => provider.provideTextSearchResults(pattern, searchOptions, progress, token));
	}
}

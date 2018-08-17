/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import * as fs from 'fs';
import * as gracefulFs from 'graceful-fs';
import { join, sep } from 'path';
import * as arrays from 'vs/base/common/arrays';
import { CancelablePromise, createCancelablePromise, toWinJsPromise } from 'vs/base/common/async';
import { CancellationToken } from 'vs/base/common/cancellation';
import { canceled } from 'vs/base/common/errors';
import { Emitter, Event } from 'vs/base/common/event';
import * as objects from 'vs/base/common/objects';
import * as strings from 'vs/base/common/strings';
import { TPromise } from 'vs/base/common/winjs.base';
import { compareItemsByScore, IItemAccessor, prepareQuery, ScorerCache } from 'vs/base/parts/quickopen/common/quickOpenScorer';
import { MAX_FILE_SIZE } from 'vs/platform/files/node/files';
import { ICachedSearchStats, IProgress } from 'vs/platform/search/common/search';
import { Engine as FileSearchEngine, FileWalker } from 'vs/workbench/services/search/node/fileSearch';
import { RipgrepEngine } from 'vs/workbench/services/search/node/ripgrepTextSearch';
import { Engine as TextSearchEngine } from 'vs/workbench/services/search/node/textSearch';
import { TextSearchWorkerProvider } from 'vs/workbench/services/search/node/textSearchWorkerProvider';
import { IFileSearchProgressItem, IRawFileMatch, IRawSearch, IRawSearchService, ISearchEngine, ISerializedFileMatch, ISerializedSearchComplete, ISerializedSearchProgressItem, ISerializedSearchSuccess, ITelemetryEvent } from './search';

gracefulFs.gracefulify(fs);

type IProgressCallback = (p: ISerializedSearchProgressItem) => void;
type IFileProgressCallback = (p: IFileSearchProgressItem) => void;

export class SearchService implements IRawSearchService {

	private static readonly BATCH_SIZE = 512;

	private caches: { [cacheKey: string]: Cache; } = Object.create(null);

	private textSearchWorkerProvider: TextSearchWorkerProvider;

	private _onTelemetry = new Emitter<ITelemetryEvent>();
	readonly onTelemetry: Event<ITelemetryEvent> = this._onTelemetry.event;

	public fileSearch(config: IRawSearch, batchSize = SearchService.BATCH_SIZE): Event<ISerializedSearchProgressItem | ISerializedSearchComplete> {
		let promise: CancelablePromise<ISerializedSearchSuccess>;

		const emitter = new Emitter<ISerializedSearchProgressItem | ISerializedSearchComplete>({
			onFirstListenerDidAdd: () => {
				promise = createCancelablePromise(token => {
					return this.doFileSearch(FileSearchEngine, config, p => emitter.fire(p), token, batchSize)
						.then(c => emitter.fire(c), err => emitter.fire({ type: 'error', error: { message: err.message, stack: err.stack } }));
				});
			},
			onLastListenerRemove: () => {
				promise.cancel();
			}
		});

		return emitter.event;
	}

	public textSearch(config: IRawSearch): Event<ISerializedSearchProgressItem | ISerializedSearchComplete> {
		let promise: CancelablePromise<void>;

		const emitter = new Emitter<ISerializedSearchProgressItem | ISerializedSearchComplete>({
			onFirstListenerDidAdd: () => {
				promise = createCancelablePromise(token => {
					return (config.useRipgrep ? this.ripgrepTextSearch(config, p => emitter.fire(p), token) : this.legacyTextSearch(config, p => emitter.fire(p), token))
						.then(c => emitter.fire(c), err => emitter.fire({ type: 'error', error: { message: err.message, stack: err.stack } }));
				});
			},
			onLastListenerRemove: () => {
				promise.cancel();
			}
		});

		return emitter.event;
	}

	private ripgrepTextSearch(config: IRawSearch, progressCallback: IProgressCallback, token: CancellationToken): Promise<ISerializedSearchSuccess> {
		config.maxFilesize = MAX_FILE_SIZE;
		let engine = new RipgrepEngine(config);

		token.onCancellationRequested(() => engine.cancel());

		return new Promise<ISerializedSearchSuccess>((c, e) => {
			// Use BatchedCollector to get new results to the frontend every 2s at least, until 50 results have been returned
			const collector = new BatchedCollector<ISerializedFileMatch>(SearchService.BATCH_SIZE, progressCallback);
			engine.search((match) => {
				collector.addItem(match, match.numMatches);
			}, (message) => {
				progressCallback(message);
			}, (error, stats) => {
				collector.flush();

				if (error) {
					e(error);
				} else {
					c(stats);
				}
			});
		});
	}

	private legacyTextSearch(config: IRawSearch, progressCallback: IProgressCallback, token: CancellationToken): Promise<ISerializedSearchComplete> {
		if (!this.textSearchWorkerProvider) {
			this.textSearchWorkerProvider = new TextSearchWorkerProvider();
		}

		let engine = new TextSearchEngine(
			config,
			new FileWalker({
				folderQueries: config.folderQueries,
				extraFiles: config.extraFiles,
				includePattern: config.includePattern,
				excludePattern: config.excludePattern,
				filePattern: config.filePattern,
				useRipgrep: false,
				maxFilesize: MAX_FILE_SIZE
			}),
			this.textSearchWorkerProvider);

		return this.doTextSearch(engine, progressCallback, SearchService.BATCH_SIZE, token);
	}

	doFileSearch(EngineClass: { new(config: IRawSearch): ISearchEngine<IRawFileMatch>; }, config: IRawSearch, progressCallback: IProgressCallback, token?: CancellationToken, batchSize?: number): TPromise<ISerializedSearchSuccess> {
		const fileProgressCallback: IFileProgressCallback = progress => {
			if (Array.isArray(progress)) {
				progressCallback(progress.map(m => this.rawMatchToSearchItem(m)));
			} else if ((<IRawFileMatch>progress).relativePath) {
				progressCallback(this.rawMatchToSearchItem(<IRawFileMatch>progress));
			} else {
				progressCallback(<IProgress>progress);
			}
		};

		if (config.sortByScore) {
			let sortedSearch = this.trySortedSearchFromCache(config, fileProgressCallback, token);
			if (!sortedSearch) {
				const walkerConfig = config.maxResults ? objects.assign({}, config, { maxResults: null }) : config;
				const engine = new EngineClass(walkerConfig);
				sortedSearch = this.doSortedSearch(engine, config, progressCallback, fileProgressCallback, token);
			}

			return new TPromise<ISerializedSearchSuccess>((c, e) => {
				process.nextTick(() => { // allow caller to register progress callback first
					sortedSearch.then(([result, rawMatches]) => {
						const serializedMatches = rawMatches.map(rawMatch => this.rawMatchToSearchItem(rawMatch));
						this.sendProgress(serializedMatches, progressCallback, batchSize);
						c(result);
					}, e);
				});
			});
		}

		const engine = new EngineClass(config);

		return this.doSearch(engine, fileProgressCallback, batchSize, token);
	}

	private rawMatchToSearchItem(match: IRawFileMatch): ISerializedFileMatch {
		return { path: match.base ? join(match.base, match.relativePath) : match.relativePath };
	}

	private doSortedSearch(engine: ISearchEngine<IRawFileMatch>, config: IRawSearch, progressCallback: IProgressCallback, fileProgressCallback: IFileProgressCallback, token?: CancellationToken): TPromise<[ISerializedSearchSuccess, IRawFileMatch[]]> {
		const emitter = new Emitter<IFileSearchProgressItem>();

		let allResultsPromise = createCancelablePromise(token => {
			let results: IRawFileMatch[] = [];

			const innerProgressCallback: IFileProgressCallback = progress => {
				if (Array.isArray(progress)) {
					results = progress;
				} else {
					fileProgressCallback(progress);
					emitter.fire(progress);
				}
			};

			return this.doSearch(engine, innerProgressCallback, -1, token)
				.then<[ISerializedSearchSuccess, IRawFileMatch[]]>(result => {
					// __GDPR__TODO__ classify event
					this._onTelemetry.fire({
						eventName: 'fileSearch',
						data: result.stats
					});

					return [result, results];
				});
		});

		let cache: Cache;
		if (config.cacheKey) {
			cache = this.getOrCreateCache(config.cacheKey);
			cache.resultsToSearchCache[config.filePattern] = {
				promise: allResultsPromise,
				event: emitter.event
			};
			allResultsPromise.then(null, err => {
				delete cache.resultsToSearchCache[config.filePattern];
			});
			allResultsPromise = this.preventCancellation(allResultsPromise);
		}

		return toWinJsPromise<[ISerializedSearchSuccess, IRawFileMatch[]]>(
			allResultsPromise.then(([result, results]) => {
				const scorerCache: ScorerCache = cache ? cache.scorerCache : Object.create(null);
				const unsortedResultTime = Date.now();
				return this.sortResults(config, results, scorerCache, token)
					.then<[ISerializedSearchSuccess, IRawFileMatch[]]>(sortedResults => {
						const sortedResultTime = Date.now();

						return [{
							type: 'success',
							stats: objects.assign({}, result.stats, {
								unsortedResultTime,
								sortedResultTime
							}),
							limitHit: result.limitHit || typeof config.maxResults === 'number' && results.length > config.maxResults
						} as ISerializedSearchSuccess, sortedResults];
					});
			})
		);
	}

	private getOrCreateCache(cacheKey: string): Cache {
		const existing = this.caches[cacheKey];
		if (existing) {
			return existing;
		}
		return this.caches[cacheKey] = new Cache();
	}

	private trySortedSearchFromCache(config: IRawSearch, progressCallback: IFileProgressCallback, token?: CancellationToken): TPromise<[ISerializedSearchSuccess, IRawFileMatch[]]> {
		const cache = config.cacheKey && this.caches[config.cacheKey];
		if (!cache) {
			return undefined;
		}

		const cacheLookupStartTime = Date.now();
		const cached = this.getResultsFromCache(cache, config.filePattern, progressCallback, token);
		if (cached) {
			return cached.then(([result, results, cacheStats]) => {
				const cacheLookupResultTime = Date.now();
				return this.sortResults(config, results, cache.scorerCache, token)
					.then<[ISerializedSearchSuccess, IRawFileMatch[]]>(sortedResults => {
						const sortedResultTime = Date.now();

						const stats: ICachedSearchStats = {
							fromCache: true,
							cacheLookupStartTime: cacheLookupStartTime,
							cacheFilterStartTime: cacheStats.cacheFilterStartTime,
							cacheLookupResultTime: cacheLookupResultTime,
							cacheEntryCount: cacheStats.cacheFilterResultCount,
							resultCount: results.length
						};
						if (config.sortByScore) {
							stats.unsortedResultTime = cacheLookupResultTime;
							stats.sortedResultTime = sortedResultTime;
						}
						if (!cacheStats.cacheWasResolved) {
							stats.joined = result.stats;
						}
						return [
							{
								type: 'success',
								limitHit: result.limitHit || typeof config.maxResults === 'number' && results.length > config.maxResults,
								stats: stats
							} as ISerializedSearchSuccess,
							sortedResults
						];
					});
			});
		}
		return undefined;
	}

	private sortResults(config: IRawSearch, results: IRawFileMatch[], scorerCache: ScorerCache, token?: CancellationToken): TPromise<IRawFileMatch[]> {
		// we use the same compare function that is used later when showing the results using fuzzy scoring
		// this is very important because we are also limiting the number of results by config.maxResults
		// and as such we want the top items to be included in this result set if the number of items
		// exceeds config.maxResults.
		const query = prepareQuery(config.filePattern);
		const compare = (matchA: IRawFileMatch, matchB: IRawFileMatch) => compareItemsByScore(matchA, matchB, query, true, FileMatchItemAccessor, scorerCache);

		return arrays.topAsync(results, compare, config.maxResults, 10000, token);
	}

	private sendProgress(results: ISerializedFileMatch[], progressCb: IProgressCallback, batchSize: number) {
		if (batchSize && batchSize > 0) {
			for (let i = 0; i < results.length; i += batchSize) {
				progressCb(results.slice(i, i + batchSize));
			}
		} else {
			progressCb(results);
		}
	}

	private getResultsFromCache(cache: Cache, searchValue: string, progressCallback: IFileProgressCallback, token?: CancellationToken): TPromise<[ISerializedSearchSuccess, IRawFileMatch[], CacheStats]> {
		// Find cache entries by prefix of search value
		const hasPathSep = searchValue.indexOf(sep) >= 0;
		let cachedRow: CacheRow;
		let wasResolved: boolean;
		for (let previousSearch in cache.resultsToSearchCache) {
			// If we narrow down, we might be able to reuse the cached results
			if (strings.startsWith(searchValue, previousSearch)) {
				if (hasPathSep && previousSearch.indexOf(sep) < 0) {
					continue; // since a path character widens the search for potential more matches, require it in previous search too
				}

				const row = cache.resultsToSearchCache[previousSearch];
				row.promise.then(() => { wasResolved = false; });
				wasResolved = true;
				cachedRow = {
					promise: this.preventCancellation(row.promise),
					event: row.event
				};
				break;
			}
		}

		if (!cachedRow) {
			return null;
		}

		const listener = cachedRow.event(progressCallback);
		if (token) {
			token.onCancellationRequested(() => {
				listener.dispose();
			});
		}

		return toWinJsPromise(cachedRow.promise.then<[ISerializedSearchSuccess, IRawFileMatch[], CacheStats]>(([complete, cachedEntries]) => {
			if (token && token.isCancellationRequested) {
				throw canceled();
			}

			const cacheFilterStartTime = Date.now();

			// Pattern match on results
			let results: IRawFileMatch[] = [];
			const normalizedSearchValueLowercase = strings.stripWildcards(searchValue).toLowerCase();
			for (let i = 0; i < cachedEntries.length; i++) {
				let entry = cachedEntries[i];

				// Check if this entry is a match for the search value
				if (!strings.fuzzyContains(entry.relativePath, normalizedSearchValueLowercase)) {
					continue;
				}

				results.push(entry);
			}

			return [complete, results, {
				cacheWasResolved: wasResolved,
				cacheFilterStartTime: cacheFilterStartTime,
				cacheFilterResultCount: cachedEntries.length
			}] as [ISerializedSearchSuccess, IRawFileMatch[], CacheStats]; // TS?
		}));
	}

	private doTextSearch(engine: TextSearchEngine, progressCallback: IProgressCallback, batchSize: number, token: CancellationToken): Promise<ISerializedSearchSuccess> {
		token.onCancellationRequested(() => engine.cancel());

		return new Promise<ISerializedSearchSuccess>((c, e) => {
			// Use BatchedCollector to get new results to the frontend every 2s at least, until 50 results have been returned
			const collector = new BatchedCollector<ISerializedFileMatch>(batchSize, progressCallback);
			engine.search((matches) => {
				const totalMatches = matches.reduce((acc, m) => acc + m.numMatches, 0);
				collector.addItems(matches, totalMatches);
			}, (progress) => {
				progressCallback(progress);
			}, (error, stats) => {
				collector.flush();

				if (error) {
					e(error);
				} else {
					c(stats);
				}
			});
		});
	}

	private doSearch(engine: ISearchEngine<IRawFileMatch>, progressCallback: IFileProgressCallback, batchSize: number, token?: CancellationToken): TPromise<ISerializedSearchSuccess> {
		return new TPromise<ISerializedSearchSuccess>((c, e) => {
			let batch: IRawFileMatch[] = [];
			if (token) {
				token.onCancellationRequested(() => engine.cancel());
			}

			engine.search((match) => {
				if (match) {
					if (batchSize) {
						batch.push(match);
						if (batchSize > 0 && batch.length >= batchSize) {
							progressCallback(batch);
							batch = [];
						}
					} else {
						progressCallback(match);
					}
				}
			}, (progress) => {
				process.nextTick(() => {
					progressCallback(progress);
				});
			}, (error, stats) => {
				if (batch.length) {
					progressCallback(batch);
				}
				if (error) {
					e(error);
				} else {
					c(stats);
				}
			});
		});
	}

	public clearCache(cacheKey: string): TPromise<void> {
		delete this.caches[cacheKey];
		return TPromise.as(undefined);
	}

	/**
	 * Return a CancelablePromise which is not actually cancelable
	 * TODO@rob - Is this really needed?
	 */
	private preventCancellation<C>(promise: CancelablePromise<C>): CancelablePromise<C> {
		return new class implements CancelablePromise<C> {
			cancel() {
				// Do nothing
			}
			then(resolve, reject) {
				return promise.then(resolve, reject);
			}
			catch(reject?) {
				return this.then(undefined, reject);
			}
		};
	}
}

interface CacheRow {
	// TODO@roblou - never actually canceled
	promise: CancelablePromise<[ISerializedSearchSuccess, IRawFileMatch[]]>;
	event: Event<IFileSearchProgressItem>;
}

class Cache {

	public resultsToSearchCache: { [searchValue: string]: CacheRow; } = Object.create(null);

	public scorerCache: ScorerCache = Object.create(null);
}

const FileMatchItemAccessor = new class implements IItemAccessor<IRawFileMatch> {

	public getItemLabel(match: IRawFileMatch): string {
		return match.basename; // e.g. myFile.txt
	}

	public getItemDescription(match: IRawFileMatch): string {
		return match.relativePath.substr(0, match.relativePath.length - match.basename.length - 1); // e.g. some/path/to/file
	}

	public getItemPath(match: IRawFileMatch): string {
		return match.relativePath; // e.g. some/path/to/file/myFile.txt
	}
};

interface CacheStats {
	cacheWasResolved: boolean;
	cacheFilterStartTime: number;
	cacheFilterResultCount: number;
}

/**
 * Collects items that have a size - before the cumulative size of collected items reaches START_BATCH_AFTER_COUNT, the callback is called for every
 * set of items collected.
 * But after that point, the callback is called with batches of maxBatchSize.
 * If the batch isn't filled within some time, the callback is also called.
 */
class BatchedCollector<T> {
	private static readonly TIMEOUT = 4000;

	// After RUN_TIMEOUT_UNTIL_COUNT items have been collected, stop flushing on timeout
	private static readonly START_BATCH_AFTER_COUNT = 50;

	private totalNumberCompleted = 0;
	private batch: T[] = [];
	private batchSize = 0;
	private timeoutHandle: number;

	constructor(private maxBatchSize: number, private cb: (items: T | T[]) => void) {
	}

	addItem(item: T, size: number): void {
		if (!item) {
			return;
		}

		if (this.maxBatchSize > 0) {
			this.addItemToBatch(item, size);
		} else {
			this.cb(item);
		}
	}

	addItems(items: T[], size: number): void {
		if (!items) {
			return;
		}

		if (this.maxBatchSize > 0) {
			this.addItemsToBatch(items, size);
		} else {
			this.cb(items);
		}
	}

	private addItemToBatch(item: T, size: number): void {
		this.batch.push(item);
		this.batchSize += size;
		this.onUpdate();
	}

	private addItemsToBatch(item: T[], size: number): void {
		this.batch = this.batch.concat(item);
		this.batchSize += size;
		this.onUpdate();
	}

	private onUpdate(): void {
		if (this.totalNumberCompleted < BatchedCollector.START_BATCH_AFTER_COUNT) {
			// Flush because we aren't batching yet
			this.flush();
		} else if (this.batchSize >= this.maxBatchSize) {
			// Flush because the batch is full
			this.flush();
		} else if (!this.timeoutHandle) {
			// No timeout running, start a timeout to flush
			this.timeoutHandle = setTimeout(() => {
				this.flush();
			}, BatchedCollector.TIMEOUT);
		}
	}

	flush(): void {
		if (this.batchSize) {
			this.totalNumberCompleted += this.batchSize;
			this.cb(this.batch);
			this.batch = [];
			this.batchSize = 0;

			if (this.timeoutHandle) {
				clearTimeout(this.timeoutHandle);
				this.timeoutHandle = 0;
			}
		}
	}
}

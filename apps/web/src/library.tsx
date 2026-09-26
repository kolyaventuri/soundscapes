import {
	sceneLibrarySchema,
	sceneDeletionResultSchema,
	type SavedScene,
} from '@soundscapes/shared';
import {useEffect, useState} from 'react';
import {request} from './api.js';
import {SceneDescription} from './scene-details.js';

export function SceneLibrary({
	revision,
	isUsable,
	onUse,
	onDelete,
}: {
	readonly revision: string;
	readonly isUsable: boolean;
	readonly onUse: (scene: SavedScene) => void;
	readonly onDelete: (closedSessionIds: string[]) => void;
}) {
	const [listing, setListing] =
		useState<ReturnType<typeof sceneLibrarySchema.parse>>();
	const [search, setSearch] = useState('');
	const [query, setQuery] = useState('');
	const [offset, setOffset] = useState(0);
	const [refresh, setRefresh] = useState(0);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState('');
	const [deleting, setDeleting] = useState<string>();
	const [notice, setNotice] = useState('');

	async function deleteScene(saved: SavedScene) {
		if (
			// eslint-disable-next-line no-alert -- Native confirmation is intentional for permanent scene deletion.
			!globalThis.confirm(
				`Delete “${saved.scene.title}” and close its sessions? This can’t be undone.`,
			)
		) {
			return;
		}

		setDeleting(saved.id);
		setError('');
		setNotice('');
		try {
			const result = await request(
				`/api/scenes/${saved.id}`,
				sceneDeletionResultSchema,
				{method: 'DELETE'},
			);
			onDelete(result.closedSessionIds);
			setNotice(
				result.cleanup === 'sessions-open'
					? 'Scene deleted. Its cache is cleared; recordings still needed by another session are kept until it closes.'
					: result.cleanup === 'pending'
						? 'Scene deleted and cache cleared. File cleanup is pending and will retry automatically.'
						: 'Scene deleted and cache cleared. Preparing this prompt again will generate fresh audio.',
			);
			if (listing?.scenes.length === 1 && offset > 0) {
				setOffset(Math.max(0, offset - listing.limit));
			}

			setRefresh((value) => value + 1);
		} catch (error_) {
			setError(
				error_ instanceof Error
					? error_.message
					: 'Could not delete the saved scene',
			);
		} finally {
			setDeleting(undefined);
		}
	}

	useEffect(() => {
		const controller = new AbortController();
		setLoading(true);
		setError('');
		setListing(undefined);
		async function load() {
			try {
				const result = await request(
					`/api/scenes?${new URLSearchParams({q: query, offset: String(offset)})}`,
					sceneLibrarySchema,
					{signal: controller.signal},
				);
				if (!controller.signal.aborted) {
					if (offset > 0 && result.scenes.length === 0) {
						setOffset(
							Math.max(0, Math.ceil(result.total / result.limit) - 1) *
								result.limit,
						);
					} else {
						setListing(result);
					}
				}
			} catch (error_) {
				if (!controller.signal.aborted)
					setError(
						error_ instanceof Error
							? error_.message
							: 'Could not load saved scenes',
					);
			} finally {
				if (!controller.signal.aborted) setLoading(false);
			}
		}

		void load();
		return () => {
			controller.abort();
		};
	}, [query, offset, refresh, revision]);
	return (
		<section className="scene-library" aria-labelledby="library-title">
			<div className="sessions-heading">
				<h2 id="library-title">Saved scenes</h2>
				<button
					type="button"
					disabled={loading}
					onClick={() => {
						setRefresh((value) => value + 1);
					}}
				>
					Refresh
				</button>
			</div>
			<p className="sessions-help">
				Prepared scenes are saved here, even after you close them. Reuse a
				description and its settings to prepare a new session; available
				recordings may be reused.
			</p>
			<form
				className="library-search"
				role="search"
				onSubmit={(event) => {
					event.preventDefault();
					setOffset(0);
					setQuery(search.trim());
					setRefresh((value) => value + 1);
				}}
			>
				<label htmlFor="scene-search">Find a scene</label>
				<div>
					<input
						id="scene-search"
						type="search"
						placeholder="Search names, places or descriptions"
						maxLength={200}
						value={search}
						onChange={(event) => {
							setSearch(event.target.value);
						}}
					/>
					<button type="submit" disabled={loading}>
						Search
					</button>
				</div>
			</form>
			{isUsable ? null : (
				<p className="sessions-help">
					You can browse while listening. Stop the current session before using
					another description.
				</p>
			)}
			{loading ? (
				<p role="status" className="sessions-help">
					Loading saved scenes…
				</p>
			) : null}
			{error ? (
				<p role="alert" className="error">
					{error}
				</p>
			) : null}
			{notice ? (
				<p role="status" className="sessions-help">
					{notice}
				</p>
			) : null}
			{listing ? (
				<>
					<p className="sessions-help" role="status">
						{listing.total === 0
							? query
								? 'No scenes match your search.'
								: 'No saved scenes yet. Prepare a scene to start your collection.'
							: `${listing.total} saved ${listing.total === 1 ? 'scene' : 'scenes'}${query ? ' matching your search' : ''}`}
					</p>
					<ul className="saved-scene-list">
						{listing.scenes.map((saved) => (
							<li key={saved.id}>
								<div className="scene-card-heading">
									<h3>{saved.scene.title}</h3>
									<span className="scene-badge">
										{saved.generationMode === 'layered' ? 'Layered' : 'Simple'}
										{saved.scene.sleepMode ? ' · Sleep' : ''}
									</span>
								</div>
								<p className="scene-excerpt">
									{saved.scene.description || saved.scene.originalPrompt}
								</p>
								<p className="session-date">
									Saved{' '}
									{new Date(saved.savedAt).toLocaleDateString(undefined, {
										year: 'numeric',
										month: 'short',
										day: 'numeric',
									})}
								</p>
								<details className="saved-details">
									<summary>View scene</summary>
									<div className="scene-summary">
										<SceneDescription scene={saved.scene} />
										{saved.layerPlan ? (
											<>
												<p className="detail-label">Planned layers</p>
												<ul>
													{saved.layerPlan.layers.map((layer) => (
														<li key={layer.id}>
															<strong>{layer.title}</strong> ·{' '}
															{layer.playback === 'continuous'
																? 'Continuous'
																: layer.playback === 'gapped'
																	? 'With breaks'
																	: 'Occasional'}
														</li>
													))}
												</ul>
											</>
										) : null}
									</div>
								</details>
								<div className="session-actions">
									<button
										type="button"
										disabled={!isUsable}
										onClick={() => {
											onUse(saved);
										}}
									>
										Use description
										<span className="sr-only"> for {saved.scene.title}</span>
									</button>
									<button
										type="button"
										disabled={Boolean(deleting)}
										onClick={() => {
											void deleteScene(saved);
										}}
									>
										{deleting === saved.id ? 'Deleting…' : 'Delete'}
										<span className="sr-only"> {saved.scene.title}</span>
									</button>
								</div>
							</li>
						))}
					</ul>
					{listing.total > listing.limit ? (
						<nav className="library-pages" aria-label="Saved scenes pages">
							<button
								type="button"
								disabled={offset === 0 || loading}
								onClick={() => {
									setOffset((value) => Math.max(0, value - listing.limit));
								}}
							>
								Previous
							</button>
							<span>
								Page {Math.floor(offset / listing.limit) + 1} of{' '}
								{Math.ceil(listing.total / listing.limit)}
							</span>
							<button
								type="button"
								disabled={offset + listing.limit >= listing.total || loading}
								onClick={() => {
									setOffset((value) => value + listing.limit);
								}}
							>
								Next
							</button>
						</nav>
					) : null}
				</>
			) : null}
		</section>
	);
}

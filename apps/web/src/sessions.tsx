import {sessionListSchema, type SessionSummary} from '@soundscapes/shared';
import {useEffect, useState} from 'react';
import {request} from './api.js';

function sessionState(session: SessionSummary) {
	if (session.status === 'active') {
		return `Playing · ${session.listenerCount} listening`;
	}

	return {
		initializing: 'Preparing',
		idle: session.ready ? 'Paused · Ready to play' : 'Preparation paused',
		error: 'Failed',
		stopped: 'Closed',
	}[session.status];
}

export function OpenSessions({
	currentId,
	isBusy,
	revision,
	onClose,
}: {
	readonly currentId: string | undefined;
	readonly isBusy: boolean;
	readonly revision: number;
	readonly onClose: (ids: string[]) => Promise<void>;
}) {
	const [listing, setListing] =
		useState<ReturnType<typeof sessionListSchema.parse>>();
	const [error, setError] = useState('');
	const [refresh, setRefresh] = useState(0);
	useEffect(() => {
		const controller = new AbortController();
		let pending = false;
		async function poll() {
			if (pending) {
				return;
			}

			pending = true;
			try {
				const result = await request('/api/sessions', sessionListSchema, {
					signal: controller.signal,
				});
				if (!controller.signal.aborted) {
					setListing(result);
					setError('');
				}
			} catch (error_) {
				if (!controller.signal.aborted) {
					setError(
						error_ instanceof Error
							? error_.message
							: 'Could not load sessions',
					);
				}
			} finally {
				pending = false;
			}
		}

		const refreshList = () => {
			void poll();
		};

		refreshList();
		const timer = setInterval(refreshList, 5000);
		globalThis.addEventListener('focus', refreshList);
		return () => {
			controller.abort();
			clearInterval(timer);
			globalThis.removeEventListener('focus', refreshList);
		};
	}, [revision, refresh]);

	return (
		<section className="open-sessions" aria-labelledby="sessions-title">
			<div className="sessions-heading">
				<h2 id="sessions-title">
					Open sessions{' '}
					{listing ? (
						<span>
							{listing.sessions.length} / {listing.limit}
						</span>
					) : null}
				</h2>
				<div className="session-actions">
					<button
						type="button"
						disabled={isBusy}
						onClick={() => {
							setRefresh((value) => value + 1);
						}}
					>
						Refresh
					</button>
					{listing && listing.sessions.length > 0 ? (
						<button
							type="button"
							disabled={isBusy}
							onClick={() => {
								void onClose(listing.sessions.map((session) => session.id));
							}}
						>
							Close all
						</button>
					) : null}
				</div>
			</div>
			<p className="sessions-help">
				Sessions stay here after their tabs close. Closing a session ends
				playback for everyone.
			</p>
			{error ? (
				<p className="error" role="alert">
					{error}
				</p>
			) : null}
			{!listing && !error ? <p role="status">Loading sessions…</p> : null}
			{listing?.sessions.length === 0 ? (
				<p className="sessions-empty">No open sessions.</p>
			) : null}
			<ul className="session-list">
				{listing?.sessions.map((session) => (
					<li key={session.id}>
						<div className="session-info">
							<h3>
								{session.title}{' '}
								{session.id === currentId ? <span>On this page</span> : null}
							</h3>
							<p>
								{sessionState(session)}
								{session.generationMode === 'layered' ? ' · Layered' : ''}
							</p>
							<p className="session-date">
								<time dateTime={session.createdAt}>
									{new Date(session.createdAt).toLocaleString(undefined, {
										month: 'short',
										day: 'numeric',
										hour: 'numeric',
										minute: '2-digit',
									})}
								</time>{' '}
								· {session.id.slice(0, 8)}
							</p>
							{session.error ? <p className="error">{session.error}</p> : null}
						</div>
						<div className="session-actions">
							{session.id !== currentId && session.status !== 'error' ? (
								<a href={`?session=${session.id}`}>Open</a>
							) : null}
							<button
								type="button"
								disabled={isBusy}
								aria-label={`Close ${session.title} (${session.id.slice(0, 8)})`}
								onClick={() => {
									void onClose([session.id]);
								}}
							>
								Close
							</button>
						</div>
					</li>
				))}
			</ul>
		</section>
	);
}

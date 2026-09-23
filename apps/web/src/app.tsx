import {
	listenerSessionSchema,
	sessionSchema,
	type ListenerSession,
	type Session,
} from '@soundscapes/shared';
import {useCallback, useEffect, useState} from 'react';
import {request} from './api.js';
import {Player} from './player.js';

function restoreConnection() {
	try {
		const stored = sessionStorage.getItem('soundscapes-listener');
		if (!stored) {
			return undefined;
		}

		const connection = listenerSessionSchema.parse(JSON.parse(stored));
		const requested = new URLSearchParams(globalThis.location.search).get(
			'session',
		);
		return requested === connection.session.id ? connection : undefined;
	} catch {
		return undefined;
	}
}

function statusLabel(session: Session) {
	const labels = {
		initializing: 'Preparing your stream…',
		active: `Streaming · ${session.listenerCount} listening`,
		idle: 'Ready · rendering paused',
		stopped: 'Session stopped',
		error: 'Preparation failed',
	};
	return labels[session.status];
}

function SessionPlayback({
	connection,
	isBusy,
	onStop,
	onSession,
	onError,
}: {
	readonly connection: ListenerSession;
	readonly isBusy: boolean;
	readonly onStop: () => Promise<void>;
	readonly onSession: (session: Session) => void;
	readonly onError: (message: string) => void;
}) {
	const {session} = connection;
	const terminal = session.status === 'stopped' || session.status === 'error';
	return (
		<>
			<p className="connection" role="status">
				<span aria-hidden="true" />
				{statusLabel(session)}
			</p>
			{session.ready && !terminal ? (
				<Player
					connection={connection}
					onSession={onSession}
					onError={onError}
				/>
			) : null}
			{terminal ? null : (
				<button
					className="stop"
					type="button"
					disabled={isBusy}
					onClick={() => {
						void onStop();
					}}
				>
					Stop session
				</button>
			)}
		</>
	);
}

function preparationLabel(join: boolean, prompt: string) {
	return join
		? 'Join this stream'
		: prompt.trim()
			? 'Prepare scene'
			: 'Prepare test stream';
}

export function App() {
	const [connection, setConnection] = useState<ListenerSession | undefined>(
		restoreConnection,
	);
	const [error, setError] = useState('');
	const [busy, setBusy] = useState(false);
	const [prompt, setPrompt] = useState('');
	const id = connection?.session.id;
	const updateSession = useCallback((session: Session) => {
		setConnection((current) =>
			current?.session.id === session.id ? {...current, session} : current,
		);
	}, []);

	useEffect(() => {
		if (!id) {
			return;
		}

		const controller = new AbortController();
		let disposed = false;
		let pending = false;
		async function poll() {
			if (pending) {
				return;
			}

			pending = true;
			try {
				const session = await request(`/api/sessions/${id}`, sessionSchema, {
					signal: controller.signal,
				});
				if (!disposed) {
					updateSession(session);
				}
			} catch (error_) {
				if (!disposed) {
					setError(
						error_ instanceof Error
							? error_.message
							: 'The local server is unavailable',
					);
				}
			} finally {
				pending = false;
			}
		}

		void poll();
		const timer = setInterval(() => {
			void poll();
		}, 2000);
		return () => {
			disposed = true;
			controller.abort();
			clearInterval(timer);
		};
	}, [id, updateSession]);

	async function prepare() {
		setBusy(true);
		setError('');
		try {
			if (connection?.session.status === 'error') {
				await request(
					`/api/sessions/${connection.session.id}/stop`,
					sessionSchema,
					{method: 'POST'},
				);
			}

			const requested = new URLSearchParams(globalThis.location.search).get(
				'session',
			);
			const result =
				requested && !connection
					? await request(
							`/api/sessions/${encodeURIComponent(requested)}/listeners`,
							listenerSessionSchema,
							{method: 'POST'},
						)
					: await request('/api/sessions', listenerSessionSchema, {
							method: 'POST',
							body: JSON.stringify({
								mode: 'ambience',
								...(prompt.trim() ? {prompt: prompt.trim()} : {}),
							}),
						});
			setConnection(result);
			globalThis.history.replaceState(
				null,
				'',
				`?session=${result.session.id}`,
			);
			try {
				sessionStorage.setItem('soundscapes-listener', JSON.stringify(result));
			} catch {
				/* Playback also works without storage. */
			}
		} catch (error_) {
			setError(
				error_ instanceof Error
					? error_.message
					: 'The stream could not be prepared',
			);
		} finally {
			setBusy(false);
		}
	}

	const stop = useCallback(async () => {
		if (!id) {
			return;
		}

		setBusy(true);
		try {
			updateSession(
				await request(`/api/sessions/${id}/stop`, sessionSchema, {
					method: 'POST',
				}),
			);
		} catch (error_) {
			setError(
				error_ instanceof Error
					? error_.message
					: 'The session could not be stopped',
			);
		} finally {
			setBusy(false);
		}
	}, [id, updateSession]);

	const session = connection?.session;
	const terminal = session?.status === 'stopped' || session?.status === 'error';
	const join =
		!connection &&
		new URLSearchParams(globalThis.location.search).has('session');
	const prepareLabel = preparationLabel(join, prompt);
	const showSetup = !session || terminal;
	const message = error || session?.error;
	return (
		<main>
			<header>
				<img src="/icon.svg" alt="" width="40" height="40" />
				<span>Soundscapes</span>
				<span className="phase-label">Local scene prototype</span>
			</header>
			<section aria-labelledby="welcome-title">
				<p className="eyebrow">A quieter kind of night</p>
				<h1 id="welcome-title">
					{session ? (
						session.title
					) : (
						<>
							A place to
							<br />
							drift off.
						</>
					)}
				</h1>
				<p className="introduction">
					Soft ambient air, streaming from your local server.
				</p>
				<div className="notice">
					<p className="notice-title">A setting for the quiet.</p>
					<p>
						Describe a place to guide occasional sounds from your local event
						library. For now, every setting uses the same soft-air test
						ambience; scene-specific audio comes later. Leave the description
						blank for a playback test without a planner.
					</p>
				</div>
				{showSetup && !join ? (
					<label className="scene-prompt">
						Scene description
						<textarea
							value={prompt}
							maxLength={4000}
							rows={4}
							disabled={busy}
							placeholder="Central Park, October 1932, around 1 AM. Cool autumn air, light wind, sparse distant activity."
							onChange={(event) => {
								setPrompt(event.target.value);
							}}
						/>
					</label>
				) : null}
				{showSetup ? (
					<button
						className="primary"
						type="button"
						disabled={busy}
						onClick={() => {
							void prepare();
						}}
					>
						{busy ? 'Preparing…' : prepareLabel}
					</button>
				) : null}
				{connection ? (
					<SessionPlayback
						connection={connection}
						isBusy={busy}
						onStop={stop}
						onSession={updateSession}
						onError={setError}
					/>
				) : null}
				{message ? (
					<p className="error" role="alert">
						{message}
					</p>
				) : null}
				{error ? <a href="/">Start a new test stream</a> : null}
			</section>
			<footer>Local by nature. Quiet by design.</footer>
		</main>
	);
}

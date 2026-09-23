import {
	listenerSessionSchema,
	sessionSchema,
	type ListenerSession,
	type Session,
} from '@soundscapes/shared';
import {useCallback, useEffect, useState} from 'react';
import {request} from './api.js';
import {Player} from './player.js';
import {PreparationFeedback} from './preparation.js';
import {InstallInfo} from './install.js';
import {StreamLevel} from './level.js';

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
		initializing: session.ready
			? 'Buffering your stream'
			: 'Building your scene',
		active: `Streaming · ${session.listenerCount} listening`,
		idle: session.ready ? 'Ready to play' : 'Preparation paused',
		stopped: 'Session stopped',
		error: session.ready ? 'Playback failed' : 'Preparation failed',
	};
	return labels[session.status];
}

function SessionPlayback({
	connection,
	isBusy,
	onStop,
	onSession,
	onError,
	isConnected,
}: {
	readonly connection: ListenerSession;
	readonly isBusy: boolean;
	readonly onStop: () => Promise<void>;
	readonly onSession: (session: Session) => void;
	readonly onError: (message: string) => void;
	readonly isConnected: boolean;
}) {
	const {session} = connection;
	const terminal = session.status === 'stopped' || session.status === 'error';
	async function resume() {
		try {
			onSession(
				await request(`/api/sessions/${session.id}/prepare`, sessionSchema, {
					method: 'POST',
					body: JSON.stringify({listenerId: connection.listenerId}),
				}),
			);
		} catch (error) {
			onError(
				error instanceof Error ? error.message : 'Could not resume preparation',
			);
		}
	}

	return (
		<>
			<p className="connection" role="status">
				<span aria-hidden="true" />
				{statusLabel(session)}
			</p>
			{session.status === 'initializing' ? (
				<PreparationFeedback
					progress={session.progress ?? undefined}
					isConnected={isConnected}
					isRebuffering={session.ready}
				/>
			) : null}
			{session.generationMode === 'layered' && !terminal ? (
				<div className="layer-summary" aria-label="Scene layers">
					<p className="notice-title">Layered scene · advanced</p>
					{session.layers.length === 0 ? (
						<p>Planning the layers from your description…</p>
					) : (
						<ul>
							{session.layers.map((layer) => (
								<li key={layer.id}>
									<strong>{layer.title}</strong>
									{' · '}
									{layer.state === 'unavailable'
										? 'Unavailable'
										: `${layer.readyClips} recordings ready${layer.state === 'generating' ? ' · Preparing' : ''}`}
									{layer.warning ? <p role="status">{layer.warning}</p> : null}
								</li>
							))}
						</ul>
					)}
				</div>
			) : null}
			{session.status === 'idle' && !session.ready ? (
				<button
					type="button"
					disabled={isBusy}
					onClick={() => {
						void resume();
					}}
				>
					Continue preparing
				</button>
			) : null}
			{session.ready && !terminal ? (
				<>
					<Player
						connection={connection}
						onSession={onSession}
						onError={onError}
					/>
					<StreamLevel
						connection={connection}
						onSession={onSession}
						onError={onError}
					/>
				</>
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
					{session.status === 'initializing'
						? 'Cancel preparation'
						: 'Stop session'}
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

function SceneSummary({session}: {readonly session: Session}) {
	const {scene} = session;
	if (!scene || !['active', 'idle'].includes(session.status)) {
		return null;
	}

	return (
		<div className="scene-summary">
			<p>{scene.description}</p>
			<dl>
				<dt>Setting</dt>
				<dd>
					{scene.location || scene.title}
					{scene.sleepMode ? ' · Sleep mode' : ''}
				</dd>
				<dt>Scene clock</dt>
				<dd>
					{new Date(session.simulatedTime).toLocaleString(undefined, {
						timeZone: 'UTC',
						year: 'numeric',
						month: 'short',
						day: 'numeric',
						hour: 'numeric',
						minute: '2-digit',
					})}
				</dd>
				<dt>Weather</dt>
				<dd>
					{Object.values(scene.weather).filter(Boolean).join(' · ') ||
						'Not specified'}
				</dd>
			</dl>
			{session.recentEvents.length > 0 ? (
				<details>
					<summary>Recent sounds</summary>
					<ul>
						{session.recentEvents.map((event) => (
							<li key={`${event.simulatedTime}-${event.description}`}>
								{event.description}
							</li>
						))}
					</ul>
				</details>
			) : null}
		</div>
	);
}

function LayeredOption({
	isLayered,
	isBusy,
	onChange,
}: {
	readonly isLayered: boolean;
	readonly isBusy: boolean;
	readonly onChange: (value: boolean) => void;
}) {
	return (
		<>
			<label className="sleep-mode">
				<input
					type="checkbox"
					checked={isLayered}
					disabled={isBusy}
					onChange={(event) => {
						onChange(event.target.checked);
					}}
				/>
				Layered scene (advanced)
				<span>
					Automatically builds the layers from your description. Takes longer to
					prepare; music, activity and effects can enter independently.
				</span>
			</label>
			{isLayered ? (
				<p className="preparation-detail">
					Describe the whole scene above—no track setup needed. Additional
					recordings take extra time; a live estimate appears as generation
					progresses. Source separation and musical transitions are
					experimental.
				</p>
			) : null}
		</>
	);
}

function preparationDisabled(
	busy: boolean,
	layered: boolean,
	prompt: string,
	join: boolean,
) {
	return busy || (layered && !prompt.trim() && !join);
}

export function App() {
	const [connection, setConnection] = useState<ListenerSession | undefined>(
		restoreConnection,
	);
	const [error, setError] = useState('');
	const [connectionError, setConnectionError] = useState('');
	const [busy, setBusy] = useState(false);
	const [prompt, setPrompt] = useState('');
	const [sleepMode, setSleepMode] = useState(false);
	const [layered, setLayered] = useState(false);
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
					setConnectionError('');
				}
			} catch (error_) {
				if (!disposed) {
					setConnectionError(
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
								sleepMode,
								generationMode: layered ? 'layered' : 'simple',
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
	const current = terminal ? undefined : session;
	const showSetup = !current;
	const message = [error, session?.error, connectionError].find(Boolean);
	return (
		<main>
			<header>
				<img src="/icon.svg" alt="" width="40" height="40" />
				<span>Soundscapes</span>
				<span className="phase-label">Local scene prototype</span>
			</header>
			<section aria-labelledby="welcome-title">
				<p className="eyebrow">Step into a scene</p>
				<h1 id="welcome-title">
					{current ? (
						current.title
					) : (
						<>
							A place to
							<br />
							spend time.
						</>
					)}
				</h1>
				<p className="introduction">
					{current
						? 'Generated locally, for you.'
						: 'Your setting, brought to life on your local server.'}
				</p>
				{showSetup ? (
					<div className="notice">
						<p className="notice-title">An environment of your own.</p>
						<p>
							Describe what you want to hear: a place, its activity, crowd
							murmur or background music. Select sleep mode if you want gentler
							dynamics. Preparing a new scene can take a few minutes. Leave the
							description blank for a soft-air playback test.
						</p>
					</div>
				) : null}
				{session ? <SceneSummary session={session} /> : null}
				{showSetup && !join ? (
					<>
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
						<label className="sleep-mode">
							<input
								type="checkbox"
								checked={sleepMode}
								disabled={busy}
								onChange={(event) => {
									setSleepMode(event.target.checked);
								}}
							/>
							Sleep mode{' '}
							<span>
								Gentler dynamics; keeps requested music and crowd murmur.
							</span>
						</label>
						<LayeredOption
							isLayered={layered}
							isBusy={busy}
							onChange={setLayered}
						/>
					</>
				) : null}
				{showSetup ? (
					<button
						className="primary"
						type="button"
						disabled={preparationDisabled(busy, layered, prompt, join)}
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
						isConnected={!connectionError}
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
			<footer>
				<InstallInfo />
				Generated locally. Shaped by your scene.
			</footer>
		</main>
	);
}

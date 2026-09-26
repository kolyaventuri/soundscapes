import {sessionListSchema, type SessionSummary} from '@soundscapes/shared';
import {useEffect, useState} from 'react';
import {request} from './api.js';
import {PlaybackDiagnostics} from './recordings.js';
import {RouteLink} from './navigation.js';

export function DiagnosticsPage({returnUrl}: {readonly returnUrl: string}) {
	const [sessions, setSessions] = useState<SessionSummary[]>([]);
	const [selected, setSelected] = useState(
		() => new URLSearchParams(globalThis.location.search).get('session') ?? '',
	);
	const [error, setError] = useState('');
	useEffect(() => {
		const controller = new AbortController();
		let timer: ReturnType<typeof setTimeout> | undefined;
		async function poll() {
			try {
				const result = await request('/api/sessions', sessionListSchema, {
					signal: controller.signal,
				});
				if (!controller.signal.aborted) {
					setSessions(result.sessions);
					setError('');
				}
			} catch (error_) {
				if (!controller.signal.aborted)
					setError(
						error_ instanceof Error
							? error_.message
							: 'Could not load sessions.',
					);
			} finally {
				if (!controller.signal.aborted)
					timer = setTimeout(() => {
						void poll();
					}, 5000);
			}
		}

		void poll();
		document
			.querySelector<HTMLHeadingElement>('#diagnostics-page-title')
			?.focus();
		return () => {
			controller.abort();
			clearTimeout(timer);
		};
	}, []);
	const session = sessions.find((session) => session.id === selected);
	return (
		<div className="diagnostics-page">
			<RouteLink href={returnUrl}>← Back to scenes</RouteLink>
			<h1 id="diagnostics-page-title" tabIndex={-1}>
				Playback diagnostics
			</h1>
			<p className="sessions-help">
				Check playback health and review previous recordings. Opening this page
				leaves your audio playing.
			</p>
			<label className="diagnostics-session" htmlFor="diagnostics-session">
				Session to monitor
				<select
					id="diagnostics-session"
					value={session ? selected : ''}
					onChange={(event) => {
						setSelected(event.target.value);
					}}
				>
					<option value="">Choose an open session</option>
					{sessions.map((session) => (
						<option key={session.id} value={session.id}>
							{session.title} ·{' '}
							{session.status === 'active'
								? 'Playing'
								: session.status === 'initializing'
									? 'Preparing'
									: 'Not playing'}{' '}
							· {session.id.slice(0, 8)}
						</option>
					))}
				</select>
			</label>
			{error ? (
				<p className="error" role="alert">
					{error}
				</p>
			) : null}
			<PlaybackDiagnostics session={error ? undefined : session} />
		</div>
	);
}

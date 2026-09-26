import {
	recordingListSchema,
	recordingSchema,
	type Recording,
	type Session,
} from '@soundscapes/shared';
import {useEffect, useState} from 'react';
import {request} from './api.js';

export function PlaybackDiagnostics({
	session,
}: {
	readonly session: Pick<Session, 'id' | 'title' | 'status'> | undefined;
}) {
	const [recordings, setRecordings] = useState<Recording[]>([]);
	const [minutes, setMinutes] = useState<5 | 480>(5);
	const [device, setDevice] = useState('');
	const [error, setError] = useState('');
	const [connectionError, setConnectionError] = useState('');
	const [loaded, setLoaded] = useState(false);
	const [busy, setBusy] = useState(false);
	const [revision, setRevision] = useState(0);
	useEffect(() => {
		const controller = new AbortController();
		let timer: ReturnType<typeof setTimeout> | undefined;
		async function poll() {
			try {
				const result = await request('/api/recordings', recordingListSchema, {
					signal: controller.signal,
				});
				if (!controller.signal.aborted) {
					setRecordings(result.recordings);
					setLoaded(true);
					setConnectionError('');
				}
			} catch (error_) {
				if (!controller.signal.aborted)
					setConnectionError(
						error_ instanceof Error
							? error_.message
							: 'Could not refresh recording status.',
					);
			} finally {
				if (!controller.signal.aborted)
					timer = setTimeout(() => {
						void poll();
					}, 5000);
			}
		}

		void poll();
		return () => {
			controller.abort();
			clearTimeout(timer);
		};
	}, [revision]);

	async function control(id?: string) {
		setBusy(true);
		setError('');
		try {
			const view = await request(
				id ? `/api/recordings/${id}/stop` : '/api/recordings',
				recordingSchema,
				{
					method: 'POST',
					...(id
						? {}
						: {
								body: JSON.stringify({
									sessionId: session?.id,
									minutes,
									device,
									client: navigator.userAgent.slice(0, 500),
								}),
							}),
				},
			);
			setRecordings((values) =>
				[view, ...values.filter((value) => value.id !== view.id)].slice(0, 20),
			);
		} catch (error_) {
			setError(
				error_ instanceof Error
					? error_.message
					: 'Recording control failed. Refresh status before retrying.',
			);
		} finally {
			setBusy(false);
			setRevision((value) => value + 1);
		}
	}

	const active = recordings.find((view) => view.state === 'recording');
	return (
		<section
			className="playback-diagnostics"
			aria-labelledby="diagnostics-title"
		>
			<div className="sessions-heading">
				<h2 id="diagnostics-title">Recording controls</h2>
				<button
					type="button"
					disabled={busy}
					onClick={() => {
						setRevision((value) => value + 1);
					}}
				>
					Refresh status
				</button>
			</div>
			<p className="sessions-help">
				Record playback health on the server while your phone is locked. No
				audio is recorded. Keep the server computer powered and awake.
			</p>
			{connectionError ? (
				<p className="error" role="alert">
					{connectionError} Displayed recording status may be out of date.
				</p>
			) : null}
			{error ? (
				<p className="error" role="alert">
					{error}
				</p>
			) : null}
			{active ? (
				<div className="recording-active">
					<p role="status">
						<strong>Recording · {active.title}</strong>
					</p>
					<p>
						{duration(active.elapsedSeconds)} of{' '}
						{active.minutes === 5 ? '5 minutes' : '8 hours'} observed ·{' '}
						{active.completeSamples}/{active.samples} complete samples
					</p>
					<progress
						max={active.minutes * 60}
						value={Math.min(active.elapsedSeconds, active.minutes * 60)}
						aria-label="Recorded duration"
					/>
					<p className="sessions-help">
						Last sample: {new Date(active.updatedAt).toLocaleTimeString()}.
						Samples every {active.minutes === 5 ? '5' : '30'} seconds. You can
						close this page and return later.
					</p>
					{active.issues.length > 0 ? (
						<p className="error">
							{active.issues.length} issue{' '}
							{active.issues.length === 1 ? 'type' : 'types'} recorded. Review
							the summary below.
						</p>
					) : null}
					<button
						type="button"
						disabled={busy || Boolean(connectionError)}
						onClick={() => {
							void control(active.id);
						}}
					>
						Stop recording
					</button>
					<p className="sessions-help">
						Stops diagnostics only. Audio keeps playing; an early stop is marked
						interrupted.
					</p>
				</div>
			) : (
				<form
					className="recording-form"
					onSubmit={(event) => {
						event.preventDefault();
						void control();
					}}
				>
					<label htmlFor="recording-duration">Recording length</label>
					<select
						id="recording-duration"
						value={minutes}
						onChange={(event) => {
							setMinutes(event.target.value === '5' ? 5 : 480);
						}}
					>
						<option value={5}>5-minute check</option>
						<option value={480}>8-hour recording</option>
					</select>
					<label htmlFor="recording-device">Test device and audio output</label>
					<input
						id="recording-device"
						value={device}
						maxLength={500}
						placeholder="iPhone model · iOS version · Bluetooth buds"
						onChange={(event) => {
							setDevice(event.target.value);
						}}
					/>
					<button
						type="submit"
						disabled={
							busy ||
							!loaded ||
							Boolean(connectionError) ||
							session?.status !== 'active'
						}
					>
						{busy ? 'Starting…' : 'Start recording'}
					</button>
					<p className="sessions-help">
						{session?.status === 'active'
							? `Records the selected session: ${session.title}.`
							: 'Start audio playback, choose its session above, then start recording.'}{' '}
						A five-minute check verifies setup; eight-hour acceptance is
						separate.
					</p>
				</form>
			)}
			{loaded ? (
				<div className="recording-history">
					<h3>Recent recordings</h3>
					{recordings.length > 0 ? (
						recordings.map((view) => (
							<RecordingDetails key={view.id} view={view} />
						))
					) : (
						<p className="sessions-help">
							No recordings yet. The latest 20 runs will remain here after you
							reload or close a session.
						</p>
					)}
				</div>
			) : (
				<p className="sessions-help" role="status">
					Loading recording status…
				</p>
			)}
		</section>
	);
}

function duration(seconds: number) {
	return seconds >= 3600
		? `${(seconds / 3600).toFixed(2)} hours`
		: `${(seconds / 60).toFixed(1)} minutes`;
}

function RecordingDetails({view}: {readonly view: Recording}) {
	const clean =
		view.state === 'completed' &&
		view.issues.length === 0 &&
		view.samples > 1 &&
		view.completeSamples === view.samples;
	return (
		<details className="recording-details">
			<summary>
				{view.title} · {view.state}
				<span>
					{new Date(view.startedAt).toLocaleString()} ·{' '}
					{duration(view.elapsedSeconds)} · {view.completeSamples}/
					{view.samples} samples
				</span>
			</summary>
			<p>
				{clean
					? 'No issues detected in sampled telemetry.'
					: view.state === 'recording'
						? 'Recording in progress. Review any issues below.'
						: 'Review required; this is not an acceptance result.'}{' '}
				Listening and physical-device acceptance remain manual.
			</p>
			{view.device ? <p>{view.device}</p> : null}
			<dl className="inference-counts">
				<dt>Planner calls</dt>
				<dd>{view.inference.plannerCalls}</dd>
				<dt>New audio recordings</dt>
				<dd>{view.inference.generatedRecordings}</dd>
				<dt>Cache reuses</dt>
				<dd>{view.inference.cacheReuses}</dd>
				<dt>Inference failures</dt>
				<dd>{view.inference.failures}</dd>
			</dl>
			<p>
				These counts cover this recording only. Zero calls or generations
				provides no corresponding inference evidence; journal gaps can make
				counts incomplete.
			</p>
			{view.issues.length > 0 ? (
				<ul>
					{view.issues.map((issue) => (
						<li key={issue.code}>
							<strong>
								{issue.code} ({issue.count})
							</strong>
							: {issue.detail}
						</li>
					))}
				</ul>
			) : (
				<p>No issues recorded.</p>
			)}
			<a
				download
				className="recording-download"
				href={`/api/recordings/${view.id}/summary`}
			>
				Download summary
			</a>
		</details>
	);
}

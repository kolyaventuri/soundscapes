import {type Scene, type Session} from '@soundscapes/shared';

export function SceneDescription({scene}: {readonly scene: Scene}) {
	return (
		<>
			<p className="detail-label">Your description</p>
			<p className="original-prompt">{scene.originalPrompt}</p>
			<p className="detail-label">Interpreted scene</p>
			<p>{scene.description || scene.title}</p>
			<dl>
				<dt>Setting</dt>
				<dd>{scene.location || scene.title}</dd>
				<dt>Weather</dt>
				<dd>
					{Object.values(scene.weather).filter(Boolean).join(' · ') ||
						'Not specified'}
				</dd>
				<dt>Activity</dt>
				<dd>{scene.activityLevel.replaceAll('-', ' ')}</dd>
				<dt>Sleep mode</dt>
				<dd>{scene.sleepMode ? 'On · gentler dynamics' : 'Off'}</dd>
			</dl>
			{scene.constraints.length > 0 ? (
				<>
					<p className="detail-label">Scene constraints</p>
					<ul>
						{scene.constraints.map((constraint) => (
							<li key={constraint}>{constraint}</li>
						))}
					</ul>
				</>
			) : null}
		</>
	);
}

function layerStatus(layer: Session['layers'][number], session: Session) {
	if (session.status === 'error') return 'Session failed';
	if (session.status === 'stopped') return 'Session closed';
	if (layer.state === 'unavailable') return 'Unavailable';
	if (layer.expansion === 'limited') return 'Ready · using existing recordings';
	if (layer.expansion === 'expanding') return 'Adding variations';
	if (layer.readyClips < layer.initialClips)
		return session.status === 'idle'
			? 'Preparation paused'
			: layer.state === 'generating'
				? 'Preparing recordings'
				: 'Waiting to prepare';
	if (layer.readyClips < layer.targetClips)
		return session.status === 'active'
			? 'Ready · more variations to follow'
			: 'Ready · more variations when playing';
	return 'Ready · pool complete';
}

export function SceneDetails({
	session,
	isConnected,
}: {
	readonly session: Session;
	readonly isConnected: boolean;
}) {
	const {scene} = session;
	if (!scene) return null;
	return (
		<details className="scene-details">
			<summary>
				Scene details{' '}
				<span>
					{session.generationMode === 'layered'
						? `${session.layers.length > 0 ? session.layers.length : 'Planning'} layers`
						: 'Single ambience mix'}
				</span>
			</summary>
			<div className="scene-summary">
				{isConnected ? null : (
					<p className="error">
						Details may be out of date while the server is unavailable.
					</p>
				)}
				<SceneDescription scene={scene} />
				<dl>
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
				</dl>
				{session.generationMode === 'layered' ? (
					<>
						<p className="detail-label">Automatically selected layers</p>
						{session.layers.length === 0 ? (
							<p>Planning the layers from your description…</p>
						) : (
							<ul className="layer-cards">
								{session.layers.map((layer) => (
									<li key={layer.id}>
										<h3>{layer.title}</h3>
										<p className="layer-status">
											{layerStatus(layer, session)} · {layer.readyClips} /{' '}
											{layer.targetClips} recordings
										</p>
										<p>
											{
												{
													continuous: 'Continuous, with overlapping fades',
													gapped: 'Passages with breaks between them',
													sparse: 'Occasional sounds',
												}[layer.playback]
											}
										</p>
										{layer.description ? <p>{layer.description}</p> : null}
										{layer.warning ? (
											<p className="error">{layer.warning}</p>
										) : null}
									</li>
								))}
							</ul>
						)}
					</>
				) : (
					<>
						<p className="detail-label">Ambience direction</p>
						<p>
							{scene.ambiencePrompt || scene.audioPrompt || scene.description}
						</p>
						<p>
							Ambience crossfades continuously. Occasional sounds are planned
							during playback; the planner may choose quiet or reuse a
							recording.
						</p>
					</>
				)}
				{session.recentEvents.length > 0 ? (
					<>
						<p className="detail-label">Recent sounds</p>
						<ul>
							{session.recentEvents.map((event) => (
								<li key={`${event.simulatedTime}-${event.description}`}>
									{event.description}
								</li>
							))}
						</ul>
					</>
				) : null}
			</div>
		</details>
	);
}

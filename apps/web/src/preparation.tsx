import {type PreparationProgress} from '@soundscapes/shared';

const labels: Record<PreparationProgress['stage'], string> = {
	understanding: 'Understanding your scene',
	checking: 'Checking saved audio',
	queued: 'Waiting for the audio generator',
	loading: 'Loading the audio model',
	generating: 'Creating your ambience',
	decoding: 'Finishing this recording',
	validating: 'Checking and balancing the audio',
	buffering: 'Preparing playback',
	ready: 'Ready to play',
};

export function estimateLabel(progress: PreparationProgress) {
	if (progress.estimate) {
		const lower = Math.max(1, Math.floor(progress.estimate.lowerMs / 60_000));
		const upper = Math.max(
			lower,
			Math.ceil(progress.estimate.upperMs / 60_000),
		);
		if (progress.estimate.upperMs < 60_000) {
			return 'About a minute or less until ready';
		}

		return `About ${lower === upper ? upper : `${lower}–${upper}`} min until ready`;
	}

	const reasons = {
		learning: 'Estimating as we learn how long this takes on your server.',
		queue: 'The generator is shared. Timing will update when it is available.',
		overrun:
			'Taking longer than previous runs. Still working; the estimate is uncertain.',
		paused: 'Preparation is paused.',
		ready: 'Ready to play.',
		measured: 'Estimating time to playback.',
	};
	return reasons[progress.estimateReason];
}

export function PreparationFeedback({
	progress,
	isConnected,
}: {
	readonly progress: PreparationProgress | undefined;
	readonly isConnected: boolean;
}) {
	const step = progress?.stage === 'generating' ? progress.step : null;
	const recordings = recordingLabel(progress, isConnected);
	const elapsed = Math.floor((progress?.elapsedMs ?? 0) / 1000);
	return (
		<div className="preparation-card" aria-label="Preparation progress">
			<p className="preparation-stage" role="status">
				{isConnected
					? labels[progress?.stage ?? 'checking']
					: 'Reconnecting to your server'}
			</p>
			<progress
				aria-label={
					step
						? 'Current recording generation steps'
						: 'Current preparation stage'
				}
				max={step?.total ?? 1}
				value={isConnected && step ? step.completed : undefined}
			/>
			{recordings ? <p className="preparation-detail">{recordings}</p> : null}
			<p className="preparation-estimate">
				{isConnected && progress
					? estimateLabel(progress)
					: 'Waiting for a live update. Your scene may still be preparing.'}
			</p>
			<p className="preparation-detail">
				{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}{' '}
				elapsed
				{progress?.estimate && isConnected
					? ' · Approximate, based on completed work on this server'
					: ''}
			</p>
			<p className="preparation-detail">Playback starts when you press play.</p>
		</div>
	);
}

function recordingLabel(
	progress: PreparationProgress | undefined,
	connected: boolean,
) {
	if (!progress || progress.totalBeds === 0) {
		return '';
	}

	const parts = [
		`${progress.completedBeds} of ${progress.totalBeds} recordings ready`,
	];
	if (progress.reusedBeds > 0) {
		parts.push(`${progress.reusedBeds} reused`);
	}

	if (connected && progress.stage === 'generating' && progress.step) {
		parts.push(`step ${progress.step.completed} of ${progress.step.total}`);
	}

	return parts.join(' · ');
}

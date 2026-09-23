import {
	type ListenerSession,
	type Session,
	sessionSchema,
} from '@soundscapes/shared';
import {useEffect, useState} from 'react';
import {request} from './api.js';

export function StreamLevel({
	connection,
	onSession,
	onError,
}: {
	readonly connection: ListenerSession;
	readonly onSession: (session: Session) => void;
	readonly onError: (message: string) => void;
}) {
	const [level, setLevel] = useState(connection.session.volumePercent);
	const [isDirty, setIsDirty] = useState(false);
	const [isSaving, setIsSaving] = useState(false);
	useEffect(() => {
		if (!isDirty) {
			setLevel(connection.session.volumePercent);
		}
	}, [connection.session.volumePercent, isDirty]);
	async function apply() {
		setIsSaving(true);
		onError('');
		try {
			const session = await request(
				`/api/sessions/${connection.session.id}/level`,
				sessionSchema,
				{
					method: 'POST',
					body: JSON.stringify({
						listenerId: connection.listenerId,
						volumePercent: level,
					}),
				},
			);
			onSession(session);
			setIsDirty(false);
		} catch (error) {
			onError(
				error instanceof Error
					? error.message
					: 'Could not change the scene level',
			);
		} finally {
			setIsSaving(false);
		}
	}

	return (
		<form
			className="stream-level"
			onSubmit={(event) => {
				event.preventDefault();
				void apply();
			}}
		>
			<label>
				Scene level <output>{level}%</output>
				<input
					type="range"
					min="0"
					max="150"
					step="5"
					value={level}
					disabled={isSaving}
					onChange={(event) => {
						setLevel(Number(event.target.value));
						setIsDirty(true);
					}}
				/>
			</label>
			<button type="submit" disabled={!isDirty || isSaving}>
				{isSaving ? 'Applying…' : 'Apply level'}
			</button>
			<p>
				Shared by everyone in this session. Changes reach you after buffered
				audio. Your device’s volume buttons respond immediately.
			</p>
		</form>
	);
}

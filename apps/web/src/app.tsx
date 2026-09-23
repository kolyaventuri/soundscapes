import {healthResponseSchema} from '@soundscapes/shared';
import {useEffect, useState} from 'react';

type Connection = 'checking' | 'connected' | 'unavailable';

export function App() {
	const [connection, setConnection] = useState<Connection>('checking');
	const [attempt, setAttempt] = useState(0);

	useEffect(() => {
		const controller = new AbortController();
		const timeout = setTimeout(() => {
			controller.abort();
		}, 5000);
		let disposed = false;

		async function checkConnection() {
			try {
				const response = await fetch('/api/health', {signal: controller.signal});
				if (!response.ok) {
					throw new Error('Service unavailable');
				}

				healthResponseSchema.parse(await response.json());
				if (!disposed) {
					setConnection('connected');
				}
			} catch {
				if (!disposed) {
					setConnection('unavailable');
				}
			} finally {
				clearTimeout(timeout);
			}
		}

		void checkConnection();
		return () => {
			disposed = true;
			clearTimeout(timeout);
			controller.abort();
		};
	}, [attempt]);

	const connectionLabel = {
		checking: 'Connecting to your local server…',
		connected: 'Connected to your local server',
		unavailable: 'Your local server is unavailable',
	}[connection];

	const retry = () => {
		setConnection('checking');
		setAttempt(value => value + 1);
	};

	return (
		<main>
			<header><img src='/icon.svg' alt='' width='40' height='40'/><span>Soundscapes</span></header>
			<section aria-labelledby='welcome-title'>
				<p className='eyebrow'>A quieter kind of night</p>
				<h1 id='welcome-title'>A place to<br/>drift off.</h1>
				<p className='introduction'>Quiet environments that unfold around you.<br/>Made locally, for a restful night.</p>
				<div className='notice'>
					<p className='notice-title'>Your quiet place is taking shape.</p>
					<p>Scene creation and audio playback are coming next.</p>
				</div>
				<p className={`connection ${connection}`} role='status'><span aria-hidden='true'/>{connectionLabel}</p>
				{connection === 'unavailable' && <button type='button' onClick={retry}>Try again</button>}
			</section>
			<footer>Local by nature. Quiet by design.</footer>
		</main>
	);
}

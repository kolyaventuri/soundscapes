import {useEffect, useState} from 'react';

export function InstallInfo() {
	const [isOffline, setIsOffline] = useState(!navigator.onLine);
	useEffect(() => {
		const update = () => {
			setIsOffline(!navigator.onLine);
		};

		globalThis.addEventListener('online', update);
		globalThis.addEventListener('offline', update);
		return () => {
			globalThis.removeEventListener('online', update);
			globalThis.removeEventListener('offline', update);
		};
	}, []);
	return (
		<>
			{isOffline ? (
				<p role="status">
					You’re offline. Connect to your local server to prepare or stream
					audio.
				</p>
			) : null}
			<details>
				<summary>Use as an app</summary>
				<p>
					In Safari on your iPhone, open your server’s trusted HTTPS address,
					then choose Share → Add to Home Screen.
				</p>
				<p>
					The app screen can be saved for offline use. Generating and streaming
					audio still need your local server.
				</p>
			</details>
		</>
	);
}

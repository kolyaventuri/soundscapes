import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {App} from './app.js';
import './styles.css';

const root = document.querySelector('#root');
if (!root) {
	throw new Error('Missing application root');
}

createRoot(root).render(
	<StrictMode>
		<App />
	</StrictMode>,
);

if (
	import.meta.env.PROD &&
	globalThis.isSecureContext &&
	'serviceWorker' in navigator
) {
	try {
		await navigator.serviceWorker.register('/sw.js');
	} catch {
		// Installation is optional; a failed shell cache must not block streaming.
	}
}

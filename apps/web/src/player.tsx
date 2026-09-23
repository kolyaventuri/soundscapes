import {
	sessionSchema,
	type ListenerSession,
	type Session,
} from '@soundscapes/shared';
import Hls from 'hls.js';
import {useEffect, useRef, useState} from 'react';
import {request} from './api.js';

type PlayerProps = {
	readonly connection: ListenerSession;
	readonly onSession: (session: Session) => void;
	readonly onError: (message: string) => void;
};

export function Player({connection, onSession, onError}: PlayerProps) {
	const audioRef = useRef<HTMLAudioElement>(null);
	const [playback, setPlayback] = useState('Ready to listen');
	const [transport, setTransport] = useState('');
	const {
		streamUrl,
		listenerId,
		session: {id, title},
	} = connection;

	useEffect(() => {
		const audio = audioRef.current;
		if (!audio) {
			return;
		}

		let disposed = false;
		let hls: Hls | undefined;
		let controls = Promise.resolve();

		async function control(action: 'play' | 'pause' | 'stop') {
			try {
				const session = await request(
					`/api/sessions/${id}/${action}`,
					sessionSchema,
					{
						method: 'POST',
						...(action === 'stop' ? {} : {body: JSON.stringify({listenerId})}),
					},
				);
				if (!disposed) {
					onSession(session);
				}
			} catch (error) {
				if (!disposed) {
					onError(
						error instanceof Error ? error.message : 'Playback control failed',
					);
					if (action === 'play') {
						audio?.pause();
					}
				}
			}
		}

		function queue(action: 'play' | 'pause' | 'stop') {
			const previous = controls;
			controls = (async () => {
				await previous;
				await control(action);
			})();
		}

		const play = () => {
			onError('');
			setPlayback('Buffering…');
			queue('play');
			hls?.startLoad(-1);
		};

		const pause = () => {
			setPlayback('Paused');
			hls?.stopLoad();
			queue('pause');
			if ('mediaSession' in navigator) {
				navigator.mediaSession.playbackState = 'paused';
			}
		};

		const playing = () => {
			setPlayback('Playing');
			if ('mediaSession' in navigator) {
				navigator.mediaSession.playbackState = 'playing';
			}
		};

		const waiting = () => {
			setPlayback('Buffering…');
		};

		const ended = () => {
			pause();
		};

		const failed = () => {
			pause();
			onError(
				'The audio stream could not be played. Pause and retry, or prepare a new test stream.',
			);
		};

		audio.addEventListener('play', play);
		audio.addEventListener('pause', pause);
		audio.addEventListener('playing', playing);
		audio.addEventListener('waiting', waiting);
		audio.addEventListener('ended', ended);
		audio.addEventListener('error', failed);

		if (audio.canPlayType('application/vnd.apple.mpegurl')) {
			audio.src = streamUrl;
			setTransport('Native HLS');
		} else if (Hls.isSupported()) {
			hls = new Hls({
				autoStartLoad: false,
				maxBufferLength: 24,
				maxMaxBufferLength: 36,
				backBufferLength: 12,
			});
			hls.loadSource(streamUrl);
			hls.attachMedia(audio);
			hls.on(Hls.Events.ERROR, (event, data) => {
				if (data.fatal && !disposed) {
					audio.pause();
					onError(
						'The stream was interrupted. Prepare a new test stream to reconnect.',
					);
				}
			});
			setTransport('HLS.js');
		} else {
			onError(
				'This browser cannot play HLS audio. Open the page in Safari or a current Chromium browser.',
			);
		}

		async function resume() {
			try {
				await audio?.play();
			} catch {
				if (!disposed) {
					onError('Tap the audio player’s play button to start listening.');
				}
			}
		}

		if ('mediaSession' in navigator) {
			navigator.mediaSession.metadata = new MediaMetadata({
				title,
				artist: 'Soundscapes',
				album: 'Local soundscape',
			});
			for (const [action, handler] of [
				[
					'play',
					() => {
						void resume();
					},
				],
				[
					'pause',
					() => {
						audio.pause();
					},
				],
				[
					'stop',
					() => {
						audio.pause();
						queue('stop');
					},
				],
			] as const) {
				try {
					navigator.mediaSession.setActionHandler(action, handler);
				} catch {
					/* Some browsers only support a subset of actions. */
				}
			}
		}

		const leave = () => {
			// Best effort: the watchdog also works when iOS suspends JavaScript.
			navigator.sendBeacon(
				`/api/sessions/${id}/pause`,
				new Blob([JSON.stringify({listenerId})], {type: 'application/json'}),
			);
		};

		window.addEventListener('pagehide', leave);

		return () => {
			disposed = true;
			window.removeEventListener('pagehide', leave);
			audio.removeEventListener('play', play);
			audio.removeEventListener('pause', pause);
			audio.removeEventListener('playing', playing);
			audio.removeEventListener('waiting', waiting);
			audio.removeEventListener('ended', ended);
			audio.removeEventListener('error', failed);
			audio.pause();
			hls?.destroy();
			audio.removeAttribute('src');
			audio.load();
			if ('mediaSession' in navigator) {
				for (const action of ['play', 'pause', 'stop'] as const) {
					try {
						navigator.mediaSession.setActionHandler(action, null);
					} catch {
						/* Unsupported action. */
					}
				}

				navigator.mediaSession.metadata = null;
				navigator.mediaSession.playbackState = 'none';
			}
		};
	}, [id, title, listenerId, streamUrl, onError, onSession]);

	return (
		<div className="player">
			<audio
				ref={audioRef}
				controls
				preload="none"
				aria-label={`${title} player`}
			/>
			<p className="playback-state" role="status">
				{playback}
			</p>
			<details>
				<summary>Playback details</summary>
				<p>{transport} · 44.1 kHz stereo AAC</p>
				<p>
					Use the same page URL on another device to join this session. Stop
					ends it for everyone.
				</p>
			</details>
		</div>
	);
}

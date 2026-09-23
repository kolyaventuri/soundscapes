import {afterEach, expect, it, vi} from 'vitest';
import {request} from './api.js';

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

it('retains the request deadline when polling supplies a cancellation signal', async () => {
	const deadline = new AbortController();
	vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
	vi.stubGlobal(
		'fetch',
		vi.fn(
			async (url: string, options: RequestInit) =>
				new Promise<Response>((resolve, reject) => {
					options.signal!.addEventListener(
						'abort',
						() => {
							reject(options.signal!.reason as Error);
						},
						{once: true},
					);
				}),
		),
	);
	const lifecycle = new AbortController();
	const pending = request(
		'/api/sessions/test',
		{parse: (value: unknown) => value},
		{signal: lifecycle.signal},
	);
	const result = expect(pending).rejects.toThrow('Request timed out');
	deadline.abort(new Error('Request timed out'));
	await result;
	expect(lifecycle.signal.aborted).toBe(false);
});

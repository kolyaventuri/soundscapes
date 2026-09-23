export async function request<T>(
	url: string,
	schema: {parse: (value: unknown) => T},
	options: RequestInit = {},
): Promise<T> {
	const response = await connect(url, {
		...options,
		signal: AbortSignal.any([
			...(options.signal ? [options.signal] : []),
			AbortSignal.timeout(25_000),
		]),
		...(options.body
			? {headers: {'Content-Type': 'application/json', ...options.headers}}
			: {}),
	});
	const body: unknown = await response.json();
	if (!response.ok) {
		const message =
			typeof body === 'object' &&
			body !== null &&
			'message' in body &&
			typeof body.message === 'string'
				? body.message
				: `Request failed (${response.status})`;
		throw new Error(message);
	}

	return schema.parse(body);
}

async function connect(url: string, options: RequestInit) {
	try {
		return await fetch(url, options);
	} catch (error) {
		if (error instanceof TypeError) {
			throw new TypeError(
				'Cannot reach your local server. Check Wi-Fi and that Soundscapes is running.',
				{cause: error},
			);
		}

		throw error;
	}
}

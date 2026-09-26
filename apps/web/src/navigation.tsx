import {useEffect, useState, type ReactNode} from 'react';

export function usePathname() {
	const [pathname, setPathname] = useState(globalThis.location.pathname);
	useEffect(() => {
		const update = () => {
			setPathname(globalThis.location.pathname);
		};

		globalThis.addEventListener('popstate', update);
		return () => {
			globalThis.removeEventListener('popstate', update);
		};
	}, []);
	return pathname;
}

export function RouteLink({
	href,
	children,
}: {
	readonly href: string;
	readonly children: ReactNode;
}) {
	return (
		<a
			href={href}
			onClick={(event) => {
				if (
					event.button !== 0 ||
					event.metaKey ||
					event.ctrlKey ||
					event.shiftKey ||
					event.altKey
				)
					return;
				event.preventDefault();
				globalThis.history.pushState(null, '', href);
				globalThis.dispatchEvent(new PopStateEvent('popstate'));
				globalThis.scrollTo(0, 0);
			}}
		>
			{children}
		</a>
	);
}

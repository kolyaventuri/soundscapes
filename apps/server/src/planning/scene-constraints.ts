import {type Scene} from '@soundscapes/shared';

const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

// Only explicit calendar tokens influence the clock; seasons and "night" are not dates.
export function explicitCalendar(prompt: string, proposedYear: Scene['year']) {
	const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(prompt);
	const monthName = new RegExp(`\\b(${months.join('|')})\\b`, 'i').exec(prompt);
	const year = iso ? Number(iso[1]) : (proposedYear !== null && new RegExp(`\\b${proposedYear}\\b`).test(prompt) ? proposedYear : null);
	const month = iso ? Number(iso[2]) : (monthName ? months.indexOf(monthName[1]!.toLowerCase()) + 1 : 1);
	const dayBefore = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+of)?\\s+(?:${months.join('|')})\\b`, 'i').exec(prompt);
	const dayAfter = new RegExp(`\\b(?:${months.join('|')})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'i').exec(prompt);
	const day = iso ? Number(iso[3]) : Number(dayBefore?.[1] ?? dayAfter?.[1] ?? 1);
	const {hour, minute} = explicitClock(prompt);

	const pad = (value: number) => String(value).padStart(2, '0');
	const simulatedStart = `${String(year ?? 2000).padStart(4, '0')}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00Z`;
	if (Number.isNaN(Date.parse(simulatedStart)) || new Date(simulatedStart).toISOString().slice(0, 19) !== simulatedStart.slice(0, 19)) {
		throw new Error('Invalid explicit calendar date');
	}

	return {year, simulatedStart};
}

function explicitClock(prompt: string) {
	const meridiem = /\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?\b/i.exec(prompt);
	const clock = /\b(\d{1,2}):(\d{2})\b/.exec(prompt);
	let hour = 1;
	let minute = 0;
	if (meridiem) {
		const value = Number(meridiem[1]);
		if (value < 1 || value > 12) {
			throw new Error('Invalid explicit clock hour');
		}

		hour = (value % 12) + (meridiem[3]!.toLowerCase() === 'p' ? 12 : 0);
		minute = Number(meridiem[2] ?? 0);
	} else if (clock) {
		hour = Number(clock[1]);
		minute = Number(clock[2]);
	} else if (/\bmidnight\b/i.test(prompt)) {
		hour = 0;
	} else if (/\bnoon\b/i.test(prompt)) {
		hour = 12;
	}

	return {hour, minute};
}

// Exclusions are user-authored. Models can otherwise turn requested sources into bans.
export function explicitSoundConstraints(prompt: string) {
	return [...new Set([...prompt.matchAll(/\b(?:no|without|avoid|exclude|do not include|don't include)\s+[^.;!?\n]+/gi)]
		.map(match => match[0].trim().slice(0, 200)))].slice(0, 12);
}

export function explicitlyExcluded(prompt: string, category: Scene['allowedEventCategories'][number]) {
	const exclusions = explicitSoundConstraints(prompt).join(' ');
	const patterns = {
		wind: /\bwind\b/i,
		leaves: /\b(rustl\w*|leaves)\b/i,
		water: /\b(rain|water|stream|waves|ocean)\b/i,
		insects: /\b(insects?|animals?|wildlife|crickets?|bugs?)\b/i,
		birds: /\b(birds?|animals?|wildlife|gulls?|chirp\w*)\b/i,
		objects: /\b(clinks?|cups?|impacts?|objects?|tableware)\b/i,
		machinery: /\b(machinery|machines?|appliances?|espresso|grinders?|horns?)\b/i,
		'distant-footsteps': /\b(people|humans?|footsteps?|walkers?)\b/i,
		'distant-wheels': /\b(vehicles?|traffic|cars?|wheels?|wagons?|carriages?)\b/i,
	};
	return patterns[category].test(exclusions);
}

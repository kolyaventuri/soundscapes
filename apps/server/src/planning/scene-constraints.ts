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

// Keep negative lists, but stop before an explicit positive/contrast clause.
// The same spans let reused generation captions omit their appended exclusions.
function exclusionSpans(prompt: string) {
	const starts = [...prompt.matchAll(/\b(?:no|without|avoid|exclude|do not include|don't include)\s+/gi)];
	return starts.map((match, index) => {
		const clause = prompt.slice(match.index, starts[index + 1]?.index).split(/[.;!?\n]/)[0]!;
		const text = clause.split(/\s*\b(?:but|yet|while|however|just|instead)\b|\s+and\s+(?=keep\b|include\b|allow\b)/i)[0]!.replace(/[,\s]+$/, '');
		return {text, start: match.index, end: match.index + text.length};
	});
}

export function explicitSoundConstraints(prompt: string) {
	return [...new Set(exclusionSpans(prompt).map(span => span.text.slice(0, 200)))].slice(0, 12);
}

// A constraint on prominence/intelligibility is not a ban on the source itself.
function sourceExclusions(prompt: string) {
	return explicitSoundConstraints(prompt).flatMap(text => text
		.replace(/^(?:no|without|avoid|exclude|do not include|don't include)\s+/i, '')
		.split(/,|\band\b|\bor\b/i)
		.map(term => term.trim())
		.filter(term => !/\b(should|must|dominat\w*|loud|close|foreground|individual|intelligible|prominent|sharp|sudden)\b/i.test(term)));
}

function positiveSoundText(text: string) {
	for (const span of exclusionSpans(text).reverse()) {
		text = text.slice(0, span.start) + ' ' + text.slice(span.end);
	}

	return text;
}

// Only broad exclusions remove an entire event category. Specific excluded
// sources are checked against actual captions/proposals/assets below.
export function explicitlyExcluded(prompt: string, category: Scene['allowedEventCategories'][number]) {
	const exclusions = sourceExclusions(prompt);
	const patterns = {
		wind: /^(?:any |all )?wind(?: sounds?| noise)?$/i,
		leaves: /^(?:any |all )?(rustl\w*|leaves)(?: sounds?| noise)?$/i,
		water: /^(?:any |all )?water(?: sounds?| noise)?$/i,
		insects: /^(?:any |all )?(insects?|animals?|wildlife|bugs?)(?: sounds?| noise)?$/i,
		birds: /^(?:any |all )?(birds?|animals?|wildlife)(?: sounds?| noise)?$/i,
		objects: /^(?:any |all )?(objects?|impacts?)(?: sounds?| noise)?$/i,
		machinery: /^(?:any |all )?(machinery|machines?|appliances?)(?: sounds?| noise)?$/i,
		'distant-footsteps': /^(?:any |all )?(people|humans?|footsteps?|walkers?)(?: sounds?| noise)?$/i,
		'distant-wheels': /^(?:any |all )?(vehicles?|traffic|wheels?)(?: sounds?| noise)?$/i,
	};
	return exclusions.some(term => patterns[category].test(term));
}

const soundFamilies = [
	/\b(rain(?:fall|drops?)?|drizzle|downpour)\b/i,
	/\b(thunder|thunderstorm)\w*\b/i,
	/\b(creeks?|streams?|brooks?|rivers?|trickl\w*)\b/i,
	/\b(waves?|surf|ocean|sea)\b/i,
	/\b(?:wind )?gust\w*\b/i,
	/\b(fog[ -]?horns?|horns?|honks?|honking)\b/i,
	/\b(espresso|coffee machine|steam wand)\b/i,
	/\b(grinders?|grinding)\b/i,
	/\b(cups?|saucers?|clinks?|clinking|tableware|crockery)\b/i,
	/\b(gulls?|seagulls?)\b/i,
	/\b(crickets?)\b/i,
	/\b(cars?|automobiles?)\b/i,
	/\b(voices?|speech|talking|conversation|chatter|murmur|dialogue)\b/i,
	/\bpiano\b/i,
	/\bguitar\b/i,
	/\bjazz\b/i,
	/\b(singing|vocals?|lyrics?)\b/i,
];
const broadFamilies = [
	{excluded: /^(?:any |all )?music$/i, sound: /\b(music|piano|jazz|guitar|singing|songs?|melody|melodies)\b/i},
	{excluded: /^(?:any |all )?water(?: sounds?| noise)?$/i, sound: /\b(water|rain|creeks?|streams?|brooks?|rivers?|waves?|surf|drips?|splash\w*)\b/i},
	{excluded: /^(?:any |all )?wind(?: sounds?| noise)?$/i, sound: /\b(wind|breeze|gust\w*)\b/i},
	{excluded: /^(?:any |all )?(leaves|rustl\w*)(?: sounds?| noise)?$/i, sound: /\b(leaves|foliage|rustl\w*)\b/i},
	{excluded: /^(?:any |all )?(animals?|wildlife|birds?)(?: sounds?| noise)?$/i, sound: /\b(birds?|gulls?|seagulls?|owls?|chirp\w*|birdsong)\b/i},
	{excluded: /^(?:any |all )?(animals?|wildlife|insects?|bugs?)(?: sounds?| noise)?$/i, sound: /\b(insects?|bugs?|crickets?|cicadas?)\b/i},
	{excluded: /^(?:any |all )?(machinery|machines?|appliances?)(?: sounds?| noise)?$/i, sound: /\b(machinery|machines?|appliances?|espresso|grinders?|horns?|foghorns?)\b/i},
	{excluded: /^(?:any |all )?(objects?|impacts?)(?: sounds?| noise)?$/i, sound: /\b(impacts?|cups?|clinks?|clinking|doors?|tableware)\b/i},
	{excluded: /^(?:any |all )?(people|humans?)(?: sounds?| noise)?$/i, sound: /\b(people|humans?|voices?|conversation|chatter|murmur|footsteps?)\b/i},
	{excluded: /^(?:any |all )?(traffic|vehicles?|wheels?)(?: sounds?| noise)?$/i, sound: /\b(traffic|vehicles?|wheels?|cars?|wagons?|carriages?)\b/i},
];

export function excludesSound(prompt: string, caption: string, category?: Scene['allowedEventCategories'][number]) {
	if (category && explicitlyExcluded(prompt, category)) {
		return true;
	}

	const exclusions = sourceExclusions(prompt);
	const sound = positiveSoundText(caption);
	return soundFamilies.some(pattern => exclusions.some(term => pattern.test(term)) && pattern.test(sound))
		|| broadFamilies.some(family => exclusions.some(term => family.excluded.test(term)) && family.sound.test(sound));
}

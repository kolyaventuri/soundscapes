import {expect, it} from 'vitest';
import {
	explicitCalendar, explicitlyExcluded, explicitSoundConstraints, excludesSound,
} from './scene-constraints.js';

it('defaults unmentioned dates while preserving explicit calendar tokens', () => {
	expect(explicitCalendar('A woodland at night in autumn.', 2023)).toEqual({year: null, simulatedStart: '2000-01-01T01:00:00Z'});
	expect(explicitCalendar('Central Park in October 1932, around 1 AM.', 1932)).toEqual({year: 1932, simulatedStart: '1932-10-01T01:00:00Z'});
	expect(explicitCalendar('The 23rd of September 2026 at 11:45 PM', 2026).simulatedStart).toBe('2026-09-23T23:45:00Z');
	expect(explicitCalendar('1932-10-04 at 22:10', null).simulatedStart).toBe('1932-10-04T22:10:00Z');
	expect(() => explicitCalendar('February 30 1932', 1932)).toThrow('calendar');
});

it('enforces explicit scene exclusions even when a model proposes an allowed category incorrectly', () => {
	const prompt = 'Steady rain on leaves, no wind. No people, voices, music, animals, thunder or sharp sounds.';
	expect(explicitlyExcluded(prompt, 'distant-footsteps')).toBe(true);
	expect(explicitlyExcluded(prompt, 'wind')).toBe(true);
	expect(explicitlyExcluded(prompt, 'insects')).toBe(true);
	expect(explicitlyExcluded(prompt, 'birds')).toBe(true);
	expect(explicitlyExcluded('A ship deck. No horns.', 'machinery')).toBe(false);
	expect(explicitlyExcluded('A cafe. No cup clinks.', 'objects')).toBe(false);
	expect(explicitlyExcluded('Occasional deafening foghorn blasts.', 'machinery')).toBe(false);
	expect(explicitlyExcluded(prompt, 'water')).toBe(false);
	expect(explicitlyExcluded('Cool park with distant activity. No rain.', 'distant-footsteps')).toBe(false);
});

it('excludes a specific source without disabling related permitted sounds', () => {
	for (const [prompt, forbidden, permitted, category] of [
		['A creek, no rain.', 'Rain patters on leaves.', 'Water trickles in a creek.', 'water'],
		['Espresso behind the counter, no horns.', 'A distant foghorn blast.', 'A brief espresso steam hiss.', 'machinery'],
		['Wind in the trees, no wind gusts.', 'A sudden wind gust.', 'A steady gentle breeze.', 'wind'],
		['Piano music without guitar.', 'A guitar melody.', 'A piano melody.', 'none'],
	] as const) {
		expect(excludesSound(prompt, forbidden, category === 'none' ? undefined : category)).toBe(true);
		expect(excludesSound(prompt, permitted, category === 'none' ? undefined : category)).toBe(false);
	}

	expect(excludesSound('No animals.', 'A cricket calls.', 'insects')).toBe(true);
	expect(excludesSound('No machinery.', 'A brief espresso hiss.', 'machinery')).toBe(true);
	expect(excludesSound('No music.', 'A piano melody.')).toBe(true);
});

it('stops exclusions before positive clauses and ignores exclusions appended to an asset caption', () => {
	expect(explicitSoundConstraints('No rain, but a creek trickles. No horns and keep the espresso machine.'))
		.toEqual(['No rain', 'No horns']);
	expect(excludesSound('No rain, but a creek trickles.', 'A creek trickles. No rain.')).toBe(false);
	expect(excludesSound('No horns and keep the espresso machine.', 'Espresso steam. No horns.')).toBe(false);
	expect(excludesSound('No rain or thunder, but keep the creek.', 'Thunder rumbles.')).toBe(true);
	expect(excludesSound('No rain, but keep the creek and no horns.', 'A foghorn blasts.')).toBe(true);
});

it('keeps requested quiet crowds and related machines when constraints target prominence or a subtype', () => {
	expect(excludesSound('Crowd murmur. No individual conversation should dominate.', 'Blended conversation.')).toBe(false);
	expect(excludesSound('An engine runs. No espresso machine.', 'An engine runs.', 'machinery')).toBe(false);
	expect(excludesSound('Piano music, no intelligible speech.', 'Blended voices with distant piano.')).toBe(false);
});

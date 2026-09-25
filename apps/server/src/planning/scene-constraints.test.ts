import {expect, it} from 'vitest';
import {explicitCalendar, explicitlyExcluded} from './scene-constraints.js';

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
	expect(explicitlyExcluded('A ship deck. No horns.', 'machinery')).toBe(true);
	expect(explicitlyExcluded('A cafe. No cup clinks.', 'objects')).toBe(true);
	expect(explicitlyExcluded('Occasional deafening foghorn blasts.', 'machinery')).toBe(false);
	expect(explicitlyExcluded(prompt, 'water')).toBe(false);
	expect(explicitlyExcluded('Cool park with distant activity. No rain.', 'distant-footsteps')).toBe(false);
});

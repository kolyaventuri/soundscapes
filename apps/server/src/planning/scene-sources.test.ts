import {expect, it} from 'vitest';
import {sceneSchema} from '@soundscapes/shared';
import {compileSceneSources} from './scene-sources.js';

it('derives both captions from the same sources without losing ongoing music or conversation', () => {
	const captions = compileSceneSources([
		{caption: 'Soft jazz piano.', timing: 'ongoing', category: 'none'},
		{caption: 'Blended room conversation.', timing: 'ongoing', category: 'none'},
		{caption: 'One cup touches a saucer.', timing: 'occasional', category: 'objects'},
		{caption: 'A brief espresso hiss.', timing: 'occasional', category: 'machinery'},
	]);
	expect(captions.ambiencePrompt).toBe('Soft jazz piano. Blended room conversation.');
	expect(captions.audioPrompt).toContain('espresso');
	expect(captions.allowedEventCategories).toEqual(['objects', 'machinery']);
});

it('keeps occasional birds out of the bed and bounds complete captions without truncation', () => {
	const creek = compileSceneSources([
		{caption: 'Water trickles over stones.', timing: 'ongoing', category: 'water'},
		{caption: 'A distant bird calls.', timing: 'occasional', category: 'birds'},
	]);
	expect(creek.ambiencePrompt).not.toContain('bird');
	expect(creek.allowedEventCategories).toContain('birds');
	const bounded = compileSceneSources(Array.from({length: 8}, () => ({caption: 'a'.repeat(80), timing: 'ongoing', category: 'none'})));
	expect(bounded.audioPrompt).toHaveLength(647);
	expect(sceneSchema.shape.ambiencePrompt.parse(bounded.ambiencePrompt)).toBe(bounded.audioPrompt);
});

it('retains allowed sources while removing excluded members of the same category', () => {
	const result = compileSceneSources([
		{caption: 'A flowing creek.', timing: 'ongoing', category: 'water'},
		{caption: 'Rain on leaves.', timing: 'ongoing', category: 'water'},
		{caption: 'A brief espresso hiss.', timing: 'occasional', category: 'machinery'},
		{caption: 'A foghorn blast.', timing: 'occasional', category: 'machinery'},
	], 'A creek beside a cafe. No rain or horns.');
	expect(result.audioPrompt).toBe('A flowing creek. A brief espresso hiss.');
	expect(result.allowedEventCategories).toEqual(['water', 'machinery']);
});

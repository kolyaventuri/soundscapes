import {createFixture} from '../audio/fixture.js';
import {loadEnvironment, readConfig} from '../config.js';

loadEnvironment();
const config = readConfig();
await createFixture(config.fixturePath, config.ffmpegPath);
console.log(`Created a 60-second stereo pink-noise fixture at ${config.fixturePath}`);

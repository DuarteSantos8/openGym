/* Loaded into the server under test (NODE_OPTIONS --import): Date.now runs ahead or behind by the
   milliseconds in TEST_CLOCK_FILE, read at every call, so a test can set the clock back. */
import fs from 'node:fs';

const file = process.env.TEST_CLOCK_FILE;
const real = Date.now;
Date.now = () => real() + (Number(fs.readFileSync(file, 'utf8')) || 0);

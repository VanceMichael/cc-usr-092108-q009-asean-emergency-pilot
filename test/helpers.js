import { readFile } from 'node:fs/promises';

export async function fixture(name) {
  const raw = await readFile(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');
  return JSON.parse(raw);
}

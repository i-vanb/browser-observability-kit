import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { getPath } from './utils.mjs';

function csvValue(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '';
  const string = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\n]/.test(string) ? `"${string.replaceAll('"', '""')}"` : string;
}

export class ArtifactStore {
  static async create({ root, prefix, csvFields }) {
    const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
    const directory = path.resolve(root, `${prefix}-${stamp}`);
    await fsp.mkdir(directory, { recursive: true });
    const store = new ArtifactStore(directory, csvFields);
    await store.initialize();
    return store;
  }

  constructor(directory, csvFields) {
    this.directory = directory;
    this.csvFields = csvFields;
    this.events = [];
    this.metrics = [];
  }

  path(name) { return path.join(this.directory, name); }

  async initialize() {
    await Promise.all([
      fsp.writeFile(this.path('metrics.csv'), `${this.csvFields.map((field) => field.name).join(',')}\n`),
      fsp.writeFile(this.path('metrics.jsonl'), ''),
      fsp.writeFile(this.path('events.jsonl'), ''),
      fsp.writeFile(this.path('chrome-stdout.log'), ''),
      fsp.writeFile(this.path('chrome-stderr.log'), '')
    ]);
  }

  recordEvent(type, data = {}, timestamp = new Date().toISOString()) {
    const event = { timestamp, type, ...data };
    this.events.push(event);
    fs.appendFileSync(this.path('events.jsonl'), `${JSON.stringify(event)}\n`);
    return event;
  }

  async appendMetric(sample) {
    this.metrics.push(sample);
    const row = this.csvFields.map((field) => {
      const value = field.get ? field.get(sample) : getPath(sample, field.path ?? field.name);
      return csvValue(value);
    }).join(',');
    await Promise.all([
      fsp.appendFile(this.path('metrics.csv'), `${row}\n`),
      fsp.appendFile(this.path('metrics.jsonl'), `${JSON.stringify(sample)}\n`)
    ]);
  }

  openLog(name) {
    return fs.openSync(this.path(name), 'a');
  }

  async writeSession(session) {
    await fsp.writeFile(this.path('session.json'), `${JSON.stringify(session, null, 2)}\n`);
  }

  async finalize({ session, writeArrays = true }) {
    await this.writeSession(session);
    if (writeArrays) {
      await Promise.all([
        fsp.writeFile(this.path('metrics.json'), `${JSON.stringify(this.metrics, null, 2)}\n`),
        fsp.writeFile(this.path('events.json'), `${JSON.stringify(this.events, null, 2)}\n`)
      ]);
    }
  }
}

export const csvField = (name, pathOrGet = name) => typeof pathOrGet === 'function'
  ? { name, get: pathOrGet }
  : { name, path: pathOrGet };

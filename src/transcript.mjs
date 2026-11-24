import { closeSync, openSync, readSync, statSync } from 'node:fs';

function nonNegInt(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? Math.trunc(num) : 0;
}

function scanTranscriptLines(lines, events, flags) {
  for (const line of lines) {
    if (!line) continue;
    if (!line.includes('"PLANNER_RESPONSE"')) {
      if (line.includes('"ERROR_MESSAGE"') || line.includes('stream was interrupted')) {
        flags.hadError = true;
      }
      if (line.includes('USER_SETTINGS_CHANGE')) {
        flags.hadSettingsChange = true;
      }
      continue;
    }

    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (!obj || obj.type !== 'PLANNER_RESPONSE') {
      if (obj?.type === 'ERROR_MESSAGE') flags.hadError = true;
      continue;
    }

    const inputTokens = nonNegInt(obj.input_tokens);
    const cacheReadTokens = nonNegInt(obj.cache_read_tokens);
    const outputTokens = nonNegInt(obj.output_tokens);
    if (inputTokens === 0 && cacheReadTokens === 0 && outputTokens === 0) continue;

    const ts = typeof obj.created_at === 'string' ? Date.parse(obj.created_at) : NaN;
    events.push({
      stepIndex: Number.isFinite(Number(obj.step_index)) ? Number(obj.step_index) : -1,
      ts: Number.isFinite(ts) ? ts : 0,
      model: typeof obj.model === 'string' && obj.model ? obj.model : 'legacy-cli',
      inputTokens,
      cacheReadTokens,
      outputTokens,
      hadErrorBefore: flags.hadError,
      hadSettingsChangeBefore: flags.hadSettingsChange,
    });
    flags.hadError = false;
    flags.hadSettingsChange = false;
  }
}

function readBytes(filePath, offset, length) {
  const buf = Buffer.allocUnsafe(length);
  const fd = openSync(filePath, 'r');
  try {
    let total = 0;
    while (total < length) {
      const n = readSync(fd, buf, total, length - total, offset + total);
      if (n <= 0) break;
      total += n;
    }
    return buf.subarray(0, total);
  } finally {
    closeSync(fd);
  }
}

export class TranscriptCache {
  constructor() {
    this.entries = new Map();
  }

  readTranscript(filePath) {
    let st;
    try {
      st = statSync(filePath);
    } catch {
      this.entries.delete(filePath);
      return null;
    }

    const prev = this.entries.get(filePath);
    if (prev && prev.mtimeMs === st.mtimeMs && prev.size === st.size) {
      return prev;
    }

    let offset = 0;
    let events = [];
    let flags = { hadError: false, hadSettingsChange: false };
    if (prev && st.size >= prev.size && prev.offset <= st.size) {
      offset = prev.offset;
      events = prev.events;
      flags = { ...prev.flags };
    }

    let trailingEvents = [];
    const delta = st.size - offset;
    if (delta > 0) {
      const chunk = readBytes(filePath, offset, delta);
      const lastNewline = chunk.lastIndexOf(0x0a);
      if (lastNewline >= 0) {
        const completeText = chunk.subarray(0, lastNewline).toString('utf-8');
        scanTranscriptLines(completeText.split('\n'), events, flags);
        offset += lastNewline + 1;
      }
      if (lastNewline + 1 < chunk.length) {
        const remainder = chunk.subarray(lastNewline + 1).toString('utf-8');
        scanTranscriptLines([remainder], trailingEvents, { ...flags });
      }
    }

    const allEvents = trailingEvents.length > 0 ? [...events, ...trailingEvents] : events;
    const entry = {
      mtimeMs: st.mtimeMs,
      size: st.size,
      offset,
      flags,
      events,
      allEvents,
    };
    this.entries.set(filePath, entry);
    return entry;
  }

  prune(activePaths) {
    for (const key of this.entries.keys()) {
      if (!activePaths.has(key)) this.entries.delete(key);
    }
  }
}

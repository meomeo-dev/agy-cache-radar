export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;
export const WINDOW_24H_MS = 24 * HOUR_MS;
export const WINDOW_30D_MS = 30 * DAY_MS;

export const MAX_TREE_DEPTH = 16;
export const SNAPSHOT_TTL_MS = 1500;
export const LIVE_RECENCY_MS = 3 * 60 * 1000;

export const CONVERSATION_ID_RE = /^[0-9a-f-]{8,}$/i;
export const ANTIGRAVITY_DIR_RE = /^antigravity(?:[-_.].+)?$/i;
export const BACKUP_DIR_RE = /(?:^|[-_.])(backup|bak|old|archive|tmp|trash)(?:[-_.]|$)/i;

export const CONFIG_FILENAME = 'cache-radar.json';
export const TRANSCRIPT_REL_PATH = ['.system_generated', 'logs', 'transcript.jsonl'];
export const SWARM_MEMBERS_REL_PATH = ['.system_generated', 'swarm', 'members.json'];

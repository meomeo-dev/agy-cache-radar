import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { CONVERSATION_ID_RE, SWARM_MEMBERS_REL_PATH } from './constants.mjs';

function statKey(filePath) {
  try {
    const st = statSync(filePath);
    return `${st.mtimeMs}:${st.size}`;
  } catch {
    return '';
  }
}

function parseIsoOrSqliteTs(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return 0;
  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function openReadOnlyDb(dbPath) {
  try {
    return new DatabaseSync(dbPath, { readOnly: true });
  } catch {
    const uri = `file:${encodeURI(dbPath)}?immutable=1`;
    return new DatabaseSync(uri, { readOnly: true });
  }
}

export class MetadataCache {
  constructor() {
    this.dbCache = new Map();
    this.swarmCache = new Map();
  }

  readSummaries(appDataDir) {
    const dbPath = join(appDataDir, 'conversation_summaries.db');
    if (!existsSync(dbPath)) return new Map();

    const key = `${statKey(dbPath)}|${statKey(`${dbPath}-wal`)}`;
    const cached = this.dbCache.get(dbPath);
    if (cached && cached.key === key) return cached.rows;

    const rows = new Map();
    let db = null;
    try {
      db = openReadOnlyDb(dbPath);
      const summaries = db
        .prepare(
          `SELECT conversation_id, title, parent_conversation_id, nesting_depth,
                  agent_name, status, not_fully_idle, killed,
                  last_modified_time, last_user_input_time, workspace_uris
             FROM conversation_summaries`
        )
        .all();

      for (const row of summaries) {
        if (!row.conversation_id) continue;
        rows.set(row.conversation_id, {
          conversationId: row.conversation_id,
          title: typeof row.title === 'string' ? row.title.trim() : '',
          parentId: typeof row.parent_conversation_id === 'string' ? row.parent_conversation_id.trim() : '',
          nestingDepth: Number(row.nesting_depth) || 0,
          agentName: typeof row.agent_name === 'string' ? row.agent_name.trim() : '',
          status: typeof row.status === 'string' ? row.status : '',
          notFullyIdle: Boolean(row.not_fully_idle),
          killed: Boolean(row.killed),
          lastModifiedMs: parseIsoOrSqliteTs(row.last_modified_time),
          lastUserInputMs: parseIsoOrSqliteTs(row.last_user_input_time),
          workspaceUris: typeof row.workspace_uris === 'string' ? row.workspace_uris : '',
        });
      }

      // Secondary table fallback for parent-child links when present.
      try {
        const parentRows = db.prepare('SELECT conversation_id, parent_id FROM conversation_parents').all();
        for (const p of parentRows) {
          if (!p.conversation_id || !p.parent_id) continue;
          const existing = rows.get(p.conversation_id);
          if (existing && !existing.parentId) {
            existing.parentId = p.parent_id;
          } else if (!existing) {
            rows.set(p.conversation_id, {
              conversationId: p.conversation_id,
              title: '',
              parentId: p.parent_id,
              nestingDepth: 1,
              agentName: '',
              status: '',
              notFullyIdle: false,
              killed: false,
              lastModifiedMs: 0,
              lastUserInputMs: 0,
              workspaceUris: '',
            });
          }
        }
      } catch {
        // conversation_parents may not exist in older schemas.
      }
    } catch {
      if (cached) return cached.rows;
    } finally {
      if (db) {
        try {
          db.close();
        } catch {
          // Ignore close errors.
        }
      }
    }

    this.dbCache.set(dbPath, { key, rows });
    return rows;
  }

  readSwarmInfo(appDataDir, conversationIds) {
    const swarmMembers = new Map();
    const swarmCoordinators = new Set();

    for (const cid of conversationIds) {
      const membersPath = join(appDataDir, 'brain', cid, ...SWARM_MEMBERS_REL_PATH);
      if (!existsSync(membersPath)) continue;

      const key = statKey(membersPath);
      let parsed = this.swarmCache.get(membersPath);
      if (!parsed || parsed.key !== key) {
        try {
          const json = JSON.parse(readFileSync(membersPath, 'utf-8'));
          parsed = { key, json };
          this.swarmCache.set(membersPath, parsed);
        } catch {
          continue;
        }
      }

      const data = parsed.json;
      if (!data || typeof data !== 'object') continue;
      const members = data.members && typeof data.members === 'object' ? data.members : {};
      swarmCoordinators.add(cid);

      for (const [rosterName, meta] of Object.entries(members)) {
        if (!meta || typeof meta !== 'object') continue;
        const memberCid = typeof meta.conversation_id === 'string' ? meta.conversation_id.trim() : '';
        if (!memberCid || !CONVERSATION_ID_RE.test(memberCid)) continue;
        const role = typeof meta.role === 'string' && meta.role ? meta.role : memberCid === cid ? 'coordinator' : 'worker';
        swarmMembers.set(memberCid, {
          coordinatorId: cid,
          swarmTitle: typeof data.title === 'string' ? data.title.trim() : '',
          rosterName,
          role,
          phase: typeof meta.phase === 'string' ? meta.phase : '',
          killed: Boolean(meta.killed),
          model: typeof meta.applied_model === 'string' ? meta.applied_model : typeof meta.model === 'string' ? meta.model : '',
        });
      }
    }

    return { swarmMembers, swarmCoordinators };
  }
}

export function readPresenceIds(appDataDir) {
  const presenceDir = join(appDataDir, 'presence');
  const active = new Set();
  if (!existsSync(presenceDir)) return active;
  let entries;
  try {
    entries = readdirSync(presenceDir, { withFileTypes: true });
  } catch {
    return active;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.lock')) continue;
    const cid = entry.name.slice(0, -'.lock'.length);
    if (CONVERSATION_ID_RE.test(cid)) active.add(cid);
  }
  return active;
}

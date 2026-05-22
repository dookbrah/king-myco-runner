import { Pool } from "pg";
import { createClient } from "redis";
import { PersistentState } from "./stateTypes";
import { PlatformEvent } from "./types";

const STATE_CACHE_KEY = "kingmyco:state:v1";
const EVENT_LIST_KEY = "kingmyco:events:v1";

type RedisLike = ReturnType<typeof createClient>;

const ensureJsonObject = <T>(value: unknown): T | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  return value as T;
};

export class PostgresRedisAdapter {
  private constructor(
    private readonly pool?: Pool,
    private readonly redis?: RedisLike,
  ) {}

  static async fromEnv(): Promise<PostgresRedisAdapter | undefined> {
    const pgUrl = process.env.KINGMYCO_PG_URL;
    const redisUrl = process.env.KINGMYCO_REDIS_URL;

    if (!pgUrl && !redisUrl) {
      return undefined;
    }

    const pool = pgUrl ? new Pool({ connectionString: pgUrl }) : undefined;
    const redis = redisUrl ? createClient({ url: redisUrl }) : undefined;

    if (redis) {
      await redis.connect();
    }

    const adapter = new PostgresRedisAdapter(pool, redis);
    await adapter.initialize();
    return adapter;
  }

  async loadSnapshot(): Promise<Partial<PersistentState> | null> {
    if (this.redis) {
      const cached = await this.redis.get(STATE_CACHE_KEY);
      if (cached) {
        try {
          const parsed = JSON.parse(cached) as unknown;
          const mapped = ensureJsonObject<Partial<PersistentState>>(parsed);
          if (mapped) {
            return mapped;
          }
        } catch {
          // Ignore malformed cache entries and fall through.
        }
      }
    }

    if (!this.pool) {
      return null;
    }

    const result = await this.pool.query<{ state_json: unknown }>(
      "SELECT state_json FROM kingmyco_state WHERE id = $1 LIMIT 1",
      ["primary"],
    );

    if (result.rowCount === 0) {
      return null;
    }

    const parsed = ensureJsonObject<Partial<PersistentState>>(
      result.rows[0]?.state_json,
    );
    if (!parsed) {
      return null;
    }

    if (this.redis) {
      await this.redis.set(STATE_CACHE_KEY, JSON.stringify(parsed));
    }

    return parsed;
  }

  async saveSnapshot(state: PersistentState): Promise<void> {
    const payload = JSON.stringify(state);

    if (this.pool) {
      await this.pool.query(
        `
          INSERT INTO kingmyco_state(id, state_json, updated_at)
          VALUES ($1, $2::jsonb, NOW())
          ON CONFLICT (id)
          DO UPDATE SET state_json = EXCLUDED.state_json, updated_at = NOW()
        `,
        ["primary", payload],
      );
    }

    if (this.redis) {
      await this.redis.set(STATE_CACHE_KEY, payload);
    }
  }

  async appendEvent(event: PlatformEvent): Promise<void> {
    const payload = JSON.stringify(event);

    if (this.pool) {
      await this.pool.query(
        `
          INSERT INTO kingmyco_events(
            event_id,
            event_type,
            source,
            player_id,
            mode,
            payload,
            created_at
          ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
          ON CONFLICT (event_id)
          DO NOTHING
        `,
        [
          event.id,
          event.type,
          event.source ?? null,
          event.playerId ?? null,
          event.mode ?? null,
          payload,
          event.timestamp,
        ],
      );
    }

    if (this.redis) {
      await this.redis.lPush(EVENT_LIST_KEY, payload);
      await this.redis.lTrim(EVENT_LIST_KEY, 0, 1999);
    }
  }

  async readRecentEvents(limit: number): Promise<PlatformEvent[]> {
    const safeLimit = Math.max(1, Math.min(limit, 2000));

    if (this.redis) {
      const rawEvents = await this.redis.lRange(EVENT_LIST_KEY, 0, safeLimit - 1);
      if (rawEvents.length > 0) {
        return rawEvents
          .map((value) => {
            try {
              return JSON.parse(value) as PlatformEvent;
            } catch {
              return null;
            }
          })
          .filter((event): event is PlatformEvent => Boolean(event));
      }
    }

    if (!this.pool) {
      return [];
    }

    const result = await this.pool.query<{ payload: unknown }>(
      `
        SELECT payload
        FROM kingmyco_events
        ORDER BY created_at DESC
        LIMIT $1
      `,
      [safeLimit],
    );

    return result.rows
      .map((row) => ensureJsonObject<PlatformEvent>(row.payload))
      .filter((event): event is PlatformEvent => Boolean(event));
  }

  private async initialize(): Promise<void> {
    if (!this.pool) {
      return;
    }

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS kingmyco_state(
        id TEXT PRIMARY KEY,
        state_json JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS kingmyco_events(
        event_id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        source TEXT,
        player_id TEXT,
        mode TEXT,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await this.pool.query(
      "CREATE INDEX IF NOT EXISTS idx_kingmyco_events_created_at ON kingmyco_events(created_at DESC)",
    );
  }
}

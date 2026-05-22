import { average } from "../utils/math";
import {
  AnalyticsSummary,
  ECOSYSTEM_SOURCES,
  EcosystemCommunicationStatus,
  EcosystemSource,
  EcosystemSourceCommunication,
  PlatformEvent,
  PlatformEventType,
} from "./types";

const initBreakdown = (): Record<PlatformEventType, number> => ({
  identity_linked: 0,
  run_generated: 0,
  session_recorded: 0,
  coaching_generated: 0,
  liveops_updated: 0,
  webhook_ingested: 0,
  solana_wallet_verified: 0,
  reward_intent_prepared: 0,
  reward_intent_status_updated: 0,
  rpg_region_traveled: 0,
  rpg_battle_started: 0,
  rpg_turn_resolved: 0,
});

const createSourceStatus = (
  source: EcosystemSource,
  minEventsPerSource: number,
): EcosystemSourceCommunication => ({
  source,
  eventCount: 0,
  observedEventTypes: [],
  healthy: minEventsPerSource <= 0,
});

export class AnalyticsService {
  communicationStatus(
    events: PlatformEvent[],
    options: {
      windowMinutes: number;
      minEventsPerSource?: number;
      nowIso?: string;
    },
  ): EcosystemCommunicationStatus {
    const windowMinutes = Math.max(1, Math.floor(options.windowMinutes));
    const minEventsPerSource = Math.max(1, Math.floor(options.minEventsPerSource ?? 1));
    const nowMs = Date.parse(options.nowIso ?? new Date().toISOString());
    const safeNowMs = Number.isNaN(nowMs) ? Date.now() : nowMs;
    const windowStartMs = safeNowMs - windowMinutes * 60 * 1000;

    const sourceStatuses = Object.fromEntries(
      ECOSYSTEM_SOURCES.map((source) => [
        source,
        createSourceStatus(source, minEventsPerSource),
      ]),
    ) as Record<EcosystemSource, EcosystemSourceCommunication>;

    let totalEventsInWindow = 0;

    for (const event of events) {
      const eventMs = Date.parse(event.timestamp);
      if (Number.isNaN(eventMs) || eventMs < windowStartMs) {
        continue;
      }

      totalEventsInWindow += 1;

      if (!event.source) {
        continue;
      }

      const status = sourceStatuses[event.source];
      status.eventCount += 1;
      status.lastEventAt =
        !status.lastEventAt || event.timestamp > status.lastEventAt
          ? event.timestamp
          : status.lastEventAt;
      if (!status.observedEventTypes.includes(event.type)) {
        status.observedEventTypes.push(event.type);
      }
    }

    for (const source of ECOSYSTEM_SOURCES) {
      const status = sourceStatuses[source];
      status.observedEventTypes.sort((left, right) => left.localeCompare(right));
      status.healthy = status.eventCount >= minEventsPerSource;
    }

    const silentSources = ECOSYSTEM_SOURCES.filter(
      (source) => sourceStatuses[source].eventCount === 0,
    );
    const activeSourceCount = ECOSYSTEM_SOURCES.length - silentSources.length;

    return {
      generatedAt: new Date(safeNowMs).toISOString(),
      windowMinutes,
      windowStart: new Date(windowStartMs).toISOString(),
      minEventsPerSource,
      requiredSources: [...ECOSYSTEM_SOURCES],
      activeSourceCount,
      allSourcesActive: silentSources.length === 0,
      totalEventsInWindow,
      sourceStatuses,
      silentSources,
    };
  }

  summarize(events: PlatformEvent[]): AnalyticsSummary {
    const eventBreakdown = initBreakdown();
    const sourceBreakdown: Partial<Record<EcosystemSource, number>> = {};
    const playerSet = new Set<string>();

    const sessionScores: number[] = [];
    let suspiciousSessionCount = 0;

    for (const event of events) {
      eventBreakdown[event.type] += 1;

      if (event.playerId) {
        playerSet.add(event.playerId);
      }

      if (event.source) {
        sourceBreakdown[event.source] = (sourceBreakdown[event.source] ?? 0) + 1;
      }

      if (event.type === "session_recorded") {
        const score = event.payload.score;
        if (typeof score === "number") {
          sessionScores.push(score);
        }

        if (event.payload.fraudFlagged === true) {
          suspiciousSessionCount += 1;
        }
      }
    }

    const sessionCount = eventBreakdown.session_recorded;

    return {
      generatedAt: new Date().toISOString(),
      windowEventCount: events.length,
      uniquePlayers: playerSet.size,
      eventBreakdown,
      sourceBreakdown,
      suspiciousSessionRate:
        sessionCount > 0 ? suspiciousSessionCount / sessionCount : 0,
      averageSessionScore: sessionScores.length > 0 ? average(sessionScores) : 0,
    };
  }
}

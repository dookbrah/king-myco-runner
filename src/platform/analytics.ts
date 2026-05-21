import { average } from "../utils/math";
import {
  AnalyticsSummary,
  EcosystemSource,
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
});

export class AnalyticsService {
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

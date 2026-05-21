import { AdaptiveDirector } from "./ai/adaptiveDirector";
import { applySessionTelemetry, createInitialProfile } from "./ai/playerModel";
import { PlannedRun, PlayerProfile, SessionTelemetry } from "./types";

interface GenerateRunOptions {
  seed?: string;
  encounters?: number;
}

export interface GenerateRunResult {
  profile: PlayerProfile;
  run: PlannedRun;
}

export class MycoQuestEngine {
  private readonly profiles = new Map<string, PlayerProfile>();
  private readonly director = new AdaptiveDirector();

  generateRun(playerId: string, options: GenerateRunOptions = {}): GenerateRunResult {
    const profile = this.getOrCreateProfile(playerId);
    const run = this.director.planRun(profile, {
      encounters: options.encounters,
      seed: options.seed ?? `${playerId}:${profile.sessionsPlayed}`,
    });

    return { profile, run };
  }

  recordSession(telemetry: SessionTelemetry): PlayerProfile {
    const currentProfile = this.getOrCreateProfile(telemetry.playerId);
    this.director.recordSessionOutcome(telemetry.playerId, telemetry);

    const updatedProfile = applySessionTelemetry(currentProfile, telemetry);
    this.profiles.set(updatedProfile.playerId, updatedProfile);
    return updatedProfile;
  }

  getProfile(playerId: string): PlayerProfile {
    return this.getOrCreateProfile(playerId);
  }

  private getOrCreateProfile(playerId: string): PlayerProfile {
    const existing = this.profiles.get(playerId);
    if (existing) {
      return existing;
    }

    const created = createInitialProfile(playerId);
    this.profiles.set(playerId, created);
    return created;
  }
}

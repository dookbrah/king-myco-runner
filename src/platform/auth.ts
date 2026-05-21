import { timingSafeEqual } from "node:crypto";
import {
  EcosystemSource,
  SourceAuthMap,
  SourceScope,
} from "./types";

const safeCompare = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
};

const normalizeConfig = (raw: unknown): SourceAuthMap => {
  if (!raw || typeof raw !== "object") {
    return {};
  }

  return raw as SourceAuthMap;
};

export class SourceAuthService {
  private constructor(private readonly sourceAuth: SourceAuthMap) {}

  static fromEnv(rawJson?: string): SourceAuthService {
    if (!rawJson) {
      return new SourceAuthService({});
    }

    const parsed = JSON.parse(rawJson) as unknown;
    return new SourceAuthService(normalizeConfig(parsed));
  }

  assertAuthorized(
    source: EcosystemSource,
    scope: SourceScope,
    token: string | undefined,
  ): void {
    const auth = this.sourceAuth[source];

    if (!auth) {
      return;
    }

    if (!token) {
      throw new Error(`Missing source token for ${source}`);
    }

    if (!safeCompare(auth.token, token)) {
      throw new Error(`Invalid source token for ${source}`);
    }

    if (!auth.scopes.includes("*") && !auth.scopes.includes(scope)) {
      throw new Error(`Source ${source} missing scope ${scope}`);
    }
  }
}

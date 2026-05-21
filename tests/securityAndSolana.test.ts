import { createHmac } from "node:crypto";
import { Keypair } from "@solana/web3.js";
import nacl from "tweetnacl";
import { describe, expect, it } from "vitest";
import { AnalyticsService } from "../src/platform/analytics";
import { SourceAuthService } from "../src/platform/auth";
import { SolanaService } from "../src/platform/solanaService";
import { WebhookVerifier } from "../src/platform/webhookVerifier";

describe("Security and Solana integration helpers", () => {
  it("validates source scope tokens", () => {
    const auth = SourceAuthService.fromEnv(
      JSON.stringify({
        openclaw: {
          token: "openclaw-token",
          scopes: ["session:write"],
        },
      }),
    );

    expect(() =>
      auth.assertAuthorized("openclaw", "session:write", "openclaw-token"),
    ).not.toThrow();

    expect(() =>
      auth.assertAuthorized("openclaw", "session:write", "wrong-token"),
    ).toThrow(/Invalid source token/);

    expect(() =>
      auth.assertAuthorized("openclaw", "run:generate", "openclaw-token"),
    ).toThrow(/missing scope/);
  });

  it("verifies webhook signatures", () => {
    const verifier = new WebhookVerifier("tg-secret", "open-secret", 300);
    const rawBody = JSON.stringify({
      event: "session_completed",
      score: 1500,
    });
    const timestamp = `${Math.floor(Date.now() / 1000)}`;
    const signature = createHmac("sha256", "open-secret")
      .update(`${timestamp}.${rawBody}`)
      .digest("hex");

    expect(verifier.verifyTelegramHeader("tg-secret")).toBe(true);
    expect(
      verifier.verifyOpenClawSignature(rawBody, `sha256=${signature}`, timestamp),
    ).toBe(true);
    expect(
      verifier.verifyOpenClawSignature(rawBody, "sha256=bad", timestamp),
    ).toBe(false);
  });

  it("verifies Solana signed wallet proof", () => {
    const service = new SolanaService("https://api.devnet.solana.com");
    const signer = Keypair.generate();
    const message = "kingmyco-wallet-link:challenge-001";
    const signature = nacl.sign.detached(
      new TextEncoder().encode(message),
      signer.secretKey,
    );

    const proof = service.verifyWalletProof({
      playerId: "player-solana",
      source: "kingmyco.io",
      externalId: "session-1",
      walletAddress: signer.publicKey.toBase58(),
      message,
      signature: Buffer.from(signature).toString("base64"),
    });

    expect(proof.verified).toBe(true);
    expect(proof.walletAddress).toBe(signer.publicKey.toBase58());
  });

  it("summarizes event analytics window", () => {
    const analytics = new AnalyticsService();
    const summary = analytics.summarize([
      {
        id: "1",
        type: "session_recorded",
        timestamp: new Date().toISOString(),
        source: "openclaw",
        playerId: "a",
        payload: {
          score: 1200,
          fraudFlagged: false,
        },
      },
      {
        id: "2",
        type: "session_recorded",
        timestamp: new Date().toISOString(),
        source: "kingmyco.io",
        playerId: "b",
        payload: {
          score: 500,
          fraudFlagged: true,
        },
      },
    ]);

    expect(summary.windowEventCount).toBe(2);
    expect(summary.uniquePlayers).toBe(2);
    expect(summary.suspiciousSessionRate).toBe(0.5);
    expect(summary.averageSessionScore).toBe(850);
  });
});

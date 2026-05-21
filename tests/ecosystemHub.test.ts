import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Keypair } from "@solana/web3.js";
import nacl from "tweetnacl";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KingMycoEcosystemHub } from "../src/platform/ecosystemHub";

let tempDir = "";
let statePath = "";
let hub: KingMycoEcosystemHub;
let priorTreasury: string | undefined;

describe("King Myco ecosystem integration", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "kingmyco-hub-"));
    statePath = join(tempDir, "state.json");
    hub = await KingMycoEcosystemHub.create(statePath);

    priorTreasury = process.env.KINGMYCO_TREASURY_WALLET;
    process.env.KINGMYCO_TREASURY_WALLET = Keypair.generate().publicKey.toBase58();
  });

  afterEach(async () => {
    if (priorTreasury) {
      process.env.KINGMYCO_TREASURY_WALLET = priorTreasury;
    } else {
      delete process.env.KINGMYCO_TREASURY_WALLET;
    }

    await rm(tempDir, { recursive: true, force: true });
  });

  it("links identities across ecosystem touchpoints", async () => {
    const first = await hub.linkIdentity({
      source: "kingmyco.io",
      externalId: "wallet-session-1",
      claims: {
        walletAddress: "0xabc123",
      },
    });

    const second = await hub.linkIdentity({
      source: "mycokingdom_bot",
      externalId: "tg-8842",
      claims: {
        walletAddress: "0xabc123",
        telegramUserId: "tg-8842",
      },
    });

    expect(first.playerId).toBe(second.playerId);
    expect(second.identities.length).toBeGreaterThanOrEqual(2);
  });

  it("quarantines suspicious sessions instead of rewarding", async () => {
    await hub.generateRun({
      source: "openclaw",
      externalId: "runner-99",
      claims: { openClawPlayerId: "runner-99" },
    });

    const receipt = await hub.recordSession({
      source: "openclaw",
      externalId: "runner-99",
      telemetry: {
        playerId: "runner-99",
        completedEncounters: 30,
        failedEncounters: 0,
        damageTaken: 0,
        perfectActions: 200,
        discoveryActions: 0,
        riskyActions: 4,
        sessionLengthSec: 32,
        usedElements: ["fire"],
        abandoned: false,
      },
      score: 999999,
      mode: "myco-quest",
    });

    expect(receipt.fraud.flagged).toBe(true);
    expect(receipt.rewards.awardedSpores).toBe(0);

    const leaderboard = hub.getLeaderboard("myco-quest", true);
    expect(leaderboard.entries).toHaveLength(0);
    expect(leaderboard.quarantined).toHaveLength(1);
  });

  it("awards spores and leaderboard placement for valid runs", async () => {
    const linked = await hub.linkIdentity({
      source: "kingdom.kingmyco.com",
      externalId: "player-alpha",
      claims: {
        walletAddress: "0xdef456",
        kingdomAccountId: "player-alpha",
      },
    });

    await hub.generateRun({
      source: "kingdom.kingmyco.com",
      externalId: "player-alpha",
      encounters: 6,
      seed: "alpha-seed",
    });

    const receipt = await hub.recordSession({
      source: "kingdom.kingmyco.com",
      externalId: "player-alpha",
      telemetry: {
        playerId: linked.playerId,
        completedEncounters: 8,
        failedEncounters: 1,
        damageTaken: 33,
        perfectActions: 5,
        discoveryActions: 4,
        riskyActions: 3,
        sessionLengthSec: 700,
        usedElements: ["fire", "water", "ice"],
        abandoned: false,
        laneOutcomes: {
          puzzle: { wins: 2, losses: 1 },
          tactics: { wins: 3, losses: 0 },
          boss: { wins: 2, losses: 0 },
        },
      },
      score: 18800,
    });

    expect(receipt.fraud.flagged).toBe(false);
    expect(receipt.rewards.awardedSpores).toBeGreaterThan(0);
    expect(receipt.wallet.spores).toBeGreaterThan(0);

    const leaderboard = hub.getLeaderboard("myco-quest");
    expect(leaderboard.entries).toHaveLength(1);
    expect(leaderboard.entries[0].playerId).toBe(linked.playerId);

    const coaching = await hub.generateCoaching({
      source: "mycoai_bot",
      externalId: "coach-alpha",
      claims: {
        walletAddress: "0xdef456",
        mycoAiUserId: "coach-alpha",
      },
      prompt: "How do I improve?",
    });

    expect(coaching.playerId).toBe(linked.playerId);
    expect(coaching.recommendations.length).toBeGreaterThan(0);
  });

  it("requires fresh wallet challenge for solana verification", async () => {
    const signer = Keypair.generate();

    const challenge = await hub.createSolanaWalletChallenge({
      source: "kingmyco.io",
      externalId: "wallet-session-1",
      claims: {
        walletAddress: signer.publicKey.toBase58(),
      },
      walletAddress: signer.publicKey.toBase58(),
    });

    const signature = nacl.sign.detached(
      new TextEncoder().encode(challenge.message),
      signer.secretKey,
    );

    const verified = await hub.verifySolanaWalletLink({
      source: "kingmyco.io",
      externalId: "wallet-session-1",
      claims: {
        walletAddress: signer.publicKey.toBase58(),
      },
      walletAddress: signer.publicKey.toBase58(),
      message: challenge.message,
      signature: Buffer.from(signature).toString("base64"),
    });

    expect(verified.verified).toBe(true);

    await expect(
      hub.verifySolanaWalletLink({
        source: "kingmyco.io",
        externalId: "wallet-session-1",
        claims: {
          walletAddress: signer.publicKey.toBase58(),
        },
        walletAddress: signer.publicKey.toBase58(),
        message: challenge.message,
        signature: Buffer.from(signature).toString("base64"),
      }),
    ).rejects.toThrow(/already been used/);
  });

  it("creates reward claims and refunds spores on failed payout", async () => {
    const signer = Keypair.generate();

    await hub.generateRun({
      source: "kingmyco.io",
      externalId: "player-sol",
      claims: { walletAddress: signer.publicKey.toBase58() },
    });

    const sessionReceipt = await hub.recordSession({
      source: "kingmyco.io",
      externalId: "player-sol",
      claims: { walletAddress: signer.publicKey.toBase58() },
      telemetry: {
        playerId: "player-sol",
        completedEncounters: 12,
        failedEncounters: 1,
        damageTaken: 40,
        perfectActions: 6,
        discoveryActions: 3,
        riskyActions: 4,
        sessionLengthSec: 780,
        usedElements: ["fire", "water"],
        abandoned: false,
      },
      score: 22500,
    });

    const challenge = await hub.createSolanaWalletChallenge({
      source: "kingmyco.io",
      externalId: "player-sol",
      claims: { walletAddress: signer.publicKey.toBase58() },
      walletAddress: signer.publicKey.toBase58(),
    });

    const signature = nacl.sign.detached(
      new TextEncoder().encode(challenge.message),
      signer.secretKey,
    );

    await hub.verifySolanaWalletLink({
      source: "kingmyco.io",
      externalId: "player-sol",
      claims: { walletAddress: signer.publicKey.toBase58() },
      walletAddress: signer.publicKey.toBase58(),
      message: challenge.message,
      signature: Buffer.from(signature).toString("base64"),
    });

    const claim = await hub.claimSolanaRewards({
      source: "kingmyco.io",
      externalId: "player-sol",
      claims: { walletAddress: signer.publicKey.toBase58() },
      destinationWallet: signer.publicKey.toBase58(),
      sporesToRedeem: 150,
    });

    expect(claim.sporesDebited).toBe(150);
    expect(claim.intent.status).toBe("prepared");
    expect(claim.wallet.spores).toBe(sessionReceipt.wallet.spores - 150);

    const failed = await hub.updateSolanaRewardTransferStatus({
      intentId: claim.intent.id,
      status: "failed",
      failureReason: "simulation failure",
    });

    expect(failed.intent.status).toBe("failed");
    expect(failed.wallet.spores).toBe(sessionReceipt.wallet.spores);
  });
});

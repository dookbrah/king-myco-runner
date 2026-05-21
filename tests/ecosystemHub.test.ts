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
let priorTreasurySecret: string | undefined;

describe("King Myco ecosystem integration", () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "kingmyco-hub-"));
    statePath = join(tempDir, "state.json");
    hub = await KingMycoEcosystemHub.create(statePath);

    priorTreasury = process.env.KINGMYCO_TREASURY_WALLET;
    priorTreasurySecret = process.env.KINGMYCO_TREASURY_SECRET;
    process.env.KINGMYCO_TREASURY_WALLET = Keypair.generate().publicKey.toBase58();
    delete process.env.KINGMYCO_TREASURY_SECRET;
  });

  afterEach(async () => {
    if (priorTreasury) {
      process.env.KINGMYCO_TREASURY_WALLET = priorTreasury;
    } else {
      delete process.env.KINGMYCO_TREASURY_WALLET;
    }

    if (priorTreasurySecret) {
      process.env.KINGMYCO_TREASURY_SECRET = priorTreasurySecret;
    } else {
      delete process.env.KINGMYCO_TREASURY_SECRET;
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
    expect(receipt.profile.sporesCollected).toBe(receipt.rewards.awardedSpores);
    expect(receipt.profile.learnedMagic.length).toBeGreaterThan(0);

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
    expect(claim.mycoBurned).toBe(37.5);
    expect(claim.intent.mycoBurned).toBe(37.5);
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
  it("worker processing marks failed intents and refunds spores", async () => {
    const signer = Keypair.generate();

    await hub.generateRun({
      source: "kingmyco.io",
      externalId: "player-settlement",
      claims: { walletAddress: signer.publicKey.toBase58() },
    });

    const sessionReceipt = await hub.recordSession({
      source: "kingmyco.io",
      externalId: "player-settlement",
      claims: { walletAddress: signer.publicKey.toBase58() },
      telemetry: {
        playerId: "player-settlement",
        completedEncounters: 9,
        failedEncounters: 1,
        damageTaken: 28,
        perfectActions: 4,
        discoveryActions: 2,
        riskyActions: 3,
        sessionLengthSec: 640,
        usedElements: ["fire", "water"],
        abandoned: false,
      },
      score: 17200,
    });

    const challenge = await hub.createSolanaWalletChallenge({
      source: "kingmyco.io",
      externalId: "player-settlement",
      claims: { walletAddress: signer.publicKey.toBase58() },
      walletAddress: signer.publicKey.toBase58(),
    });

    const signature = nacl.sign.detached(
      new TextEncoder().encode(challenge.message),
      signer.secretKey,
    );

    await hub.verifySolanaWalletLink({
      source: "kingmyco.io",
      externalId: "player-settlement",
      claims: { walletAddress: signer.publicKey.toBase58() },
      walletAddress: signer.publicKey.toBase58(),
      message: challenge.message,
      signature: Buffer.from(signature).toString("base64"),
    });

    const claim = await hub.claimSolanaRewards({
      source: "kingmyco.io",
      externalId: "player-settlement",
      claims: { walletAddress: signer.publicKey.toBase58() },
      destinationWallet: signer.publicKey.toBase58(),
      sporesToRedeem: 120,
    });

    const processed = await hub.processPreparedTransferIntent(claim.intent.id);

    expect(processed.intent.status).toBe("failed");
    expect(processed.wallet.spores).toBe(sessionReceipt.wallet.spores);

    const prepared = hub.getTransferIntents({ status: "prepared" });
    expect(prepared.find((intent) => intent.id === claim.intent.id)).toBeUndefined();
  });

  it("reuses same intent for idempotent reward claim retries", async () => {
    const signer = Keypair.generate();

    await hub.generateRun({
      source: "kingmyco.io",
      externalId: "player-idempotent",
      claims: { walletAddress: signer.publicKey.toBase58() },
    });

    await hub.recordSession({
      source: "kingmyco.io",
      externalId: "player-idempotent",
      claims: { walletAddress: signer.publicKey.toBase58() },
      telemetry: {
        playerId: "player-idempotent",
        completedEncounters: 14,
        failedEncounters: 0,
        damageTaken: 22,
        perfectActions: 7,
        discoveryActions: 5,
        riskyActions: 4,
        sessionLengthSec: 890,
        usedElements: ["fire", "water", "ice"],
        abandoned: false,
      },
      score: 24400,
    });

    const challenge = await hub.createSolanaWalletChallenge({
      source: "kingmyco.io",
      externalId: "player-idempotent",
      claims: { walletAddress: signer.publicKey.toBase58() },
      walletAddress: signer.publicKey.toBase58(),
    });

    const signature = nacl.sign.detached(
      new TextEncoder().encode(challenge.message),
      signer.secretKey,
    );

    await hub.verifySolanaWalletLink({
      source: "kingmyco.io",
      externalId: "player-idempotent",
      claims: { walletAddress: signer.publicKey.toBase58() },
      walletAddress: signer.publicKey.toBase58(),
      message: challenge.message,
      signature: Buffer.from(signature).toString("base64"),
    });

    const first = await hub.claimSolanaRewards({
      source: "kingmyco.io",
      externalId: "player-idempotent",
      claims: { walletAddress: signer.publicKey.toBase58() },
      destinationWallet: signer.publicKey.toBase58(),
      sporesToRedeem: 200,
      idempotencyKey: "claim-key-1",
    });

    const second = await hub.claimSolanaRewards({
      source: "kingmyco.io",
      externalId: "player-idempotent",
      claims: { walletAddress: signer.publicKey.toBase58() },
      destinationWallet: signer.publicKey.toBase58(),
      sporesToRedeem: 200,
      idempotencyKey: "claim-key-1",
    });

    expect(second.reused).toBe(true);
    expect(second.intent.id).toBe(first.intent.id);
    expect(second.mycoBurned).toBe(first.mycoBurned);
    expect(second.wallet.spores).toBe(first.wallet.spores);
  });

  it("enforces claim cooldown and daily cap guardrails", async () => {
    const signer = Keypair.generate();

    await hub.updateLiveOps({
      claimCooldownSec: 3600,
      maxDailySporeRedeem: 250,
      minSporesPerClaim: 100,
      maxSporesPerClaim: 1000,
    });

    await hub.generateRun({
      source: "kingmyco.io",
      externalId: "player-guardrails",
      claims: { walletAddress: signer.publicKey.toBase58() },
    });

    await hub.recordSession({
      source: "kingmyco.io",
      externalId: "player-guardrails",
      claims: { walletAddress: signer.publicKey.toBase58() },
      telemetry: {
        playerId: "player-guardrails",
        completedEncounters: 14,
        failedEncounters: 0,
        damageTaken: 26,
        perfectActions: 6,
        discoveryActions: 3,
        riskyActions: 4,
        sessionLengthSec: 800,
        usedElements: ["fire", "water", "ice"],
        abandoned: false,
      },
      score: 23000,
    });

    const challenge = await hub.createSolanaWalletChallenge({
      source: "kingmyco.io",
      externalId: "player-guardrails",
      claims: { walletAddress: signer.publicKey.toBase58() },
      walletAddress: signer.publicKey.toBase58(),
    });

    const signature = nacl.sign.detached(
      new TextEncoder().encode(challenge.message),
      signer.secretKey,
    );

    await hub.verifySolanaWalletLink({
      source: "kingmyco.io",
      externalId: "player-guardrails",
      claims: { walletAddress: signer.publicKey.toBase58() },
      walletAddress: signer.publicKey.toBase58(),
      message: challenge.message,
      signature: Buffer.from(signature).toString("base64"),
    });

    const first = await hub.claimSolanaRewards({
      source: "kingmyco.io",
      externalId: "player-guardrails",
      claims: { walletAddress: signer.publicKey.toBase58() },
      destinationWallet: signer.publicKey.toBase58(),
      sporesToRedeem: 200,
    });

    expect(first.sporesDebited).toBe(200);

    await expect(
      hub.claimSolanaRewards({
        source: "kingmyco.io",
        externalId: "player-guardrails",
        claims: { walletAddress: signer.publicKey.toBase58() },
        destinationWallet: signer.publicKey.toBase58(),
        sporesToRedeem: 120,
      }),
    ).rejects.toThrow(/Claim cooldown active/);

    await hub.updateLiveOps({ claimCooldownSec: 0 });

    await expect(
      hub.claimSolanaRewards({
        source: "kingmyco.io",
        externalId: "player-guardrails",
        claims: { walletAddress: signer.publicKey.toBase58() },
        destinationWallet: signer.publicKey.toBase58(),
        sporesToRedeem: 100,
      }),
    ).rejects.toThrow(/Daily claim cap exceeded/);
  });

  it("enforces wallet and IP claim velocity throttles", async () => {
    const signerA = Keypair.generate();
    const signerB = Keypair.generate();

    await hub.updateLiveOps({
      claimCooldownSec: 0,
      maxDailySporeRedeem: 500000,
      minSporesPerClaim: 100,
      maxSporesPerClaim: 1000,
      maxClaimsPerHourPerWallet: 1,
      maxClaimsPerHourPerIp: 50,
      maxUniqueWalletsPerIpPerDay: 10,
    });

    await hub.generateRun({
      source: "kingmyco.io",
      externalId: "velocity-player-a",
      claims: { walletAddress: signerA.publicKey.toBase58() },
    });

    await hub.recordSession({
      source: "kingmyco.io",
      externalId: "velocity-player-a",
      claims: { walletAddress: signerA.publicKey.toBase58() },
      telemetry: {
        playerId: "velocity-player-a",
        completedEncounters: 12,
        failedEncounters: 1,
        damageTaken: 30,
        perfectActions: 6,
        discoveryActions: 3,
        riskyActions: 4,
        sessionLengthSec: 760,
        usedElements: ["fire", "water"],
        abandoned: false,
      },
      score: 21000,
    });

    const challengeA = await hub.createSolanaWalletChallenge({
      source: "kingmyco.io",
      externalId: "velocity-player-a",
      claims: { walletAddress: signerA.publicKey.toBase58() },
      walletAddress: signerA.publicKey.toBase58(),
    });

    const signatureA = nacl.sign.detached(
      new TextEncoder().encode(challengeA.message),
      signerA.secretKey,
    );

    await hub.verifySolanaWalletLink({
      source: "kingmyco.io",
      externalId: "velocity-player-a",
      claims: { walletAddress: signerA.publicKey.toBase58() },
      walletAddress: signerA.publicKey.toBase58(),
      message: challengeA.message,
      signature: Buffer.from(signatureA).toString("base64"),
    });

    await hub.claimSolanaRewards({
      source: "kingmyco.io",
      externalId: "velocity-player-a",
      claims: { walletAddress: signerA.publicKey.toBase58() },
      destinationWallet: signerA.publicKey.toBase58(),
      sporesToRedeem: 120,
      clientIp: "198.51.100.10",
    });

    await expect(
      hub.claimSolanaRewards({
        source: "kingmyco.io",
        externalId: "velocity-player-a",
        claims: { walletAddress: signerA.publicKey.toBase58() },
        destinationWallet: signerA.publicKey.toBase58(),
        sporesToRedeem: 120,
        clientIp: "198.51.100.10",
      }),
    ).rejects.toThrow(/Wallet claim velocity exceeded/);

    await hub.updateLiveOps({
      maxClaimsPerHourPerWallet: 10,
      maxClaimsPerHourPerIp: 50,
      maxUniqueWalletsPerIpPerDay: 1,
    });

    await hub.generateRun({
      source: "kingmyco.io",
      externalId: "velocity-player-b",
      claims: { walletAddress: signerB.publicKey.toBase58() },
    });

    await hub.recordSession({
      source: "kingmyco.io",
      externalId: "velocity-player-b",
      claims: { walletAddress: signerB.publicKey.toBase58() },
      telemetry: {
        playerId: "velocity-player-b",
        completedEncounters: 12,
        failedEncounters: 0,
        damageTaken: 24,
        perfectActions: 7,
        discoveryActions: 4,
        riskyActions: 3,
        sessionLengthSec: 810,
        usedElements: ["fire", "water", "ice"],
        abandoned: false,
      },
      score: 22800,
    });

    const challengeB = await hub.createSolanaWalletChallenge({
      source: "kingmyco.io",
      externalId: "velocity-player-b",
      claims: { walletAddress: signerB.publicKey.toBase58() },
      walletAddress: signerB.publicKey.toBase58(),
    });

    const signatureB = nacl.sign.detached(
      new TextEncoder().encode(challengeB.message),
      signerB.secretKey,
    );

    await hub.verifySolanaWalletLink({
      source: "kingmyco.io",
      externalId: "velocity-player-b",
      claims: { walletAddress: signerB.publicKey.toBase58() },
      walletAddress: signerB.publicKey.toBase58(),
      message: challengeB.message,
      signature: Buffer.from(signatureB).toString("base64"),
    });

    await expect(
      hub.claimSolanaRewards({
        source: "kingmyco.io",
        externalId: "velocity-player-b",
        claims: { walletAddress: signerB.publicKey.toBase58() },
        destinationWallet: signerB.publicKey.toBase58(),
        sporesToRedeem: 120,
        clientIp: "198.51.100.10",
      }),
    ).rejects.toThrow(/IP wallet diversity limit exceeded/);
  });


  it("emits ecosystem heartbeat pulses for configured sources", async () => {
    const pulse = await hub.emitEcosystemHeartbeat({
      sources: ["kingmyco.io", "openclaw"],
      eventName: "worker_heartbeat",
      payload: {
        origin: "test-suite",
      },
    });

    expect(pulse.emittedCount).toBe(2);
    expect(pulse.sources).toEqual(["kingmyco.io", "openclaw"]);
    expect(pulse.eventName).toBe("worker_heartbeat");

    const status = await hub.getEcosystemCommunicationStatus({
      windowMinutes: 60,
      minEventsPerSource: 1,
      limit: 300,
    });

    expect(status.sourceStatuses["kingmyco.io"].healthy).toBe(true);
    expect(status.sourceStatuses.openclaw.healthy).toBe(true);
    expect(status.sourceStatuses.mycoai_bot.healthy).toBe(false);
    expect(status.allSourcesActive).toBe(false);
  });


  it("reports all ecosystem sources as active when communicating", async () => {
    await hub.linkIdentity({
      source: "mycokingdom_bot",
      externalId: "tg-comms-1",
      claims: {
        telegramUserId: "tg-comms-1",
      },
    });

    await hub.generateCoaching({
      source: "mycoai_bot",
      externalId: "ai-comms-1",
      claims: {
        mycoAiUserId: "ai-comms-1",
      },
      prompt: "status",
    });

    await hub.generateRun({
      source: "kingdom.kingmyco.com",
      externalId: "kingdom-comms-1",
      claims: {
        kingdomAccountId: "kingdom-comms-1",
      },
      encounters: 4,
      seed: "comms-seed",
    });

    await hub.linkIdentity({
      source: "kingmyco.io",
      externalId: "web-comms-1",
      claims: {
        walletAddress: "0xcommunicationwallet",
      },
    });

    await hub.ingestWebhookEvent("openclaw", "comms_heartbeat", {
      system: "openclaw",
      ok: true,
    });

    const status = await hub.getEcosystemCommunicationStatus({
      windowMinutes: 180,
      minEventsPerSource: 1,
      limit: 500,
    });

    expect(status.allSourcesActive).toBe(true);
    expect(status.silentSources).toHaveLength(0);
    for (const source of status.requiredSources) {
      expect(status.sourceStatuses[source].healthy).toBe(true);
      expect(status.sourceStatuses[source].eventCount).toBeGreaterThan(0);
    }
  });

  it("temporarily blocks high-risk claimants adaptively", async () => {
    const signer = Keypair.generate();

    await hub.updateLiveOps({
      claimCooldownSec: 0,
      maxDailySporeRedeem: 500000,
      minSporesPerClaim: 100,
      maxSporesPerClaim: 1000,
      maxClaimsPerHourPerWallet: 20,
      maxClaimsPerHourPerIp: 100,
      maxUniqueWalletsPerIpPerDay: 20,
      riskHardBlockThreshold: 0.2,
      riskThrottleWeight: 0.9,
      riskScoreDecayPerHour: 0,
    });

    await hub.generateRun({
      source: "kingmyco.io",
      externalId: "player-risk-adaptive",
      claims: { walletAddress: signer.publicKey.toBase58() },
    });

    await hub.recordSession({
      source: "kingmyco.io",
      externalId: "player-risk-adaptive",
      claims: { walletAddress: signer.publicKey.toBase58() },
      telemetry: {
        playerId: "player-risk-adaptive",
        completedEncounters: 12,
        failedEncounters: 1,
        damageTaken: 25,
        perfectActions: 6,
        discoveryActions: 3,
        riskyActions: 4,
        sessionLengthSec: 760,
        usedElements: ["fire", "water"],
        abandoned: false,
      },
      score: 21000,
    });

    await hub.recordSession({
      source: "kingmyco.io",
      externalId: "player-risk-adaptive",
      claims: { walletAddress: signer.publicKey.toBase58() },
      telemetry: {
        playerId: "player-risk-adaptive",
        completedEncounters: 25,
        failedEncounters: 0,
        damageTaken: 0,
        perfectActions: 160,
        discoveryActions: 0,
        riskyActions: 2,
        sessionLengthSec: 28,
        usedElements: ["fire"],
        abandoned: false,
      },
      score: 800000,
    });

    const challenge = await hub.createSolanaWalletChallenge({
      source: "kingmyco.io",
      externalId: "player-risk-adaptive",
      claims: { walletAddress: signer.publicKey.toBase58() },
      walletAddress: signer.publicKey.toBase58(),
    });

    const signature = nacl.sign.detached(
      new TextEncoder().encode(challenge.message),
      signer.secretKey,
    );

    await hub.verifySolanaWalletLink({
      source: "kingmyco.io",
      externalId: "player-risk-adaptive",
      claims: { walletAddress: signer.publicKey.toBase58() },
      walletAddress: signer.publicKey.toBase58(),
      message: challenge.message,
      signature: Buffer.from(signature).toString("base64"),
    });

    await expect(
      hub.claimSolanaRewards({
        source: "kingmyco.io",
        externalId: "player-risk-adaptive",
        claims: { walletAddress: signer.publicKey.toBase58() },
        destinationWallet: signer.publicKey.toBase58(),
        sporesToRedeem: 120,
        clientIp: "198.51.100.77",
      }),
    ).rejects.toThrow(/temporarily blocked due to elevated risk/);
  });

});

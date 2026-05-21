import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import { Keypair, Transaction } from "@solana/web3.js";
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

  it("supports remote signer mode without local secret", async () => {
    const treasury = Keypair.generate();
    const destination = Keypair.generate();

    const priorMode = process.env.KINGMYCO_TREASURY_SIGNER_MODE;
    const priorWallet = process.env.KINGMYCO_TREASURY_WALLET;
    const priorSecret = process.env.KINGMYCO_TREASURY_SECRET;
    const priorEndpoint = process.env.KINGMYCO_TREASURY_SIGNER_ENDPOINT;
    const priorToken = process.env.KINGMYCO_TREASURY_SIGNER_BEARER_TOKEN;

    let submittedRaw: Buffer | undefined;
    let signerServer: ReturnType<typeof createServer> | undefined;

    try {
      process.env.KINGMYCO_TREASURY_SIGNER_MODE = "remote-hsm";
      process.env.KINGMYCO_TREASURY_WALLET = treasury.publicKey.toBase58();
      process.env.KINGMYCO_TREASURY_SIGNER_BEARER_TOKEN = "hsm-token";
      delete process.env.KINGMYCO_TREASURY_SECRET;

      signerServer = createServer(async (request, response) => {
        const authHeader = request.headers.authorization;
        if (authHeader !== "Bearer hsm-token") {
          response.statusCode = 401;
          response.end("unauthorized");
          return;
        }

        const chunks: Buffer[] = [];
        for await (const chunk of request) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }

        const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
          unsignedTransactionBase64: string;
        };

        const transaction = Transaction.from(
          Buffer.from(body.unsignedTransactionBase64, "base64"),
        );
        transaction.sign(treasury);

        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            signedTransactionBase64: transaction
              .serialize({ requireAllSignatures: false, verifySignatures: false })
              .toString("base64"),
          }),
        );
      });

      await new Promise<void>((resolve) => signerServer?.listen(0, resolve));
      const address = signerServer?.address();
      if (!address || typeof address === "string") {
        throw new Error("Failed to bind signer test server");
      }

      process.env.KINGMYCO_TREASURY_SIGNER_ENDPOINT = `http://127.0.0.1:${address.port}`;

      const service = new SolanaService("https://api.devnet.solana.com");
      const serviceAny = service as unknown as {
        connection: {
          getLatestBlockhash: (commitment: "finalized") => Promise<{
            blockhash: string;
            lastValidBlockHeight: number;
          }>;
          sendRawTransaction: (raw: Buffer, opts: unknown) => Promise<string>;
        };
      };

      serviceAny.connection = {
        getLatestBlockhash: async () => ({
          blockhash: "11111111111111111111111111111111",
          lastValidBlockHeight: 99,
        }),
        sendRawTransaction: async (raw) => {
          submittedRaw = raw;
          return "mocked-chain-signature";
        },
      };

      const intent = await service.prepareSolTransfer({
        playerId: "remote-player",
        source: "kingmyco.io",
        destinationWallet: destination.publicKey.toBase58(),
        lamports: 5000,
      });

      const result = await service.submitPreparedTransferIntent(intent);
      expect(result.txSignature).toBe("mocked-chain-signature");
      expect(submittedRaw).toBeDefined();

      const submittedTx = Transaction.from(submittedRaw as Buffer);
      const treasurySig = submittedTx.signatures.find(({ publicKey }) =>
        publicKey.equals(treasury.publicKey),
      );
      expect(treasurySig?.signature).toBeTruthy();

    } finally {
      if (signerServer) {
        await new Promise<void>((resolve, reject) =>
          signerServer?.close((error) => (error ? reject(error) : resolve())),
        );
      }

      if (priorMode) {
        process.env.KINGMYCO_TREASURY_SIGNER_MODE = priorMode;
      } else {
        delete process.env.KINGMYCO_TREASURY_SIGNER_MODE;
      }

      if (priorWallet) {
        process.env.KINGMYCO_TREASURY_WALLET = priorWallet;
      } else {
        delete process.env.KINGMYCO_TREASURY_WALLET;
      }

      if (priorSecret) {
        process.env.KINGMYCO_TREASURY_SECRET = priorSecret;
      } else {
        delete process.env.KINGMYCO_TREASURY_SECRET;
      }

      if (priorEndpoint) {
        process.env.KINGMYCO_TREASURY_SIGNER_ENDPOINT = priorEndpoint;
      } else {
        delete process.env.KINGMYCO_TREASURY_SIGNER_ENDPOINT;
      }

      if (priorToken) {
        process.env.KINGMYCO_TREASURY_SIGNER_BEARER_TOKEN = priorToken;
      } else {
        delete process.env.KINGMYCO_TREASURY_SIGNER_BEARER_TOKEN;
      }
    }
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

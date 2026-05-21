import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import nacl from "tweetnacl";
import { randomUUID } from "node:crypto";
import {
  EcosystemSource,
  SolanaRewardTransferIntent,
  SolanaRewardTransferRequest,
  SolanaWalletProof,
  SolanaWalletSnapshot,
} from "./types";

interface WalletProofInput {
  playerId: string;
  source: EcosystemSource;
  externalId: string;
  walletAddress: string;
  message: string;
  signature: string;
}

const MEMO_PROGRAM = new PublicKey(
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr",
);
const FALLBACK_BLOCKHASH = "11111111111111111111111111111111";

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_MAP = new Map(
  Array.from(BASE58_ALPHABET).map((character, index) => [character, index]),
);

const decodeBase58 = (value: string): Uint8Array => {
  if (value.length === 0) {
    return new Uint8Array();
  }

  const bytes = [0];

  for (const character of value) {
    const alphabetIndex = BASE58_MAP.get(character);
    if (alphabetIndex === undefined) {
      throw new Error("input contains invalid base58 characters");
    }

    let carry = alphabetIndex;
    for (let index = 0; index < bytes.length; index += 1) {
      carry += bytes[index] * 58;
      bytes[index] = carry & 0xff;
      carry >>= 8;
    }

    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  for (let index = 0; index < value.length && value[index] === "1"; index += 1) {
    bytes.push(0);
  }

  return new Uint8Array(bytes.reverse());
};

const decodeSignature = (signature: string): Uint8Array => {
  const normalized = signature.trim();

  if (normalized.length === 0) {
    throw new Error("signature cannot be empty");
  }

  const maybeBase64 = normalized.startsWith("base64:")
    ? normalized.slice("base64:".length)
    : normalized;

  try {
    const fromBase64 = Buffer.from(maybeBase64, "base64");
    if (fromBase64.length > 0) {
      const normalizedRoundTrip = fromBase64
        .toString("base64")
        .replace(/=+$/u, "");
      const incomingRoundTrip = maybeBase64.replace(/=+$/u, "");
      if (normalizedRoundTrip === incomingRoundTrip) {
        return new Uint8Array(fromBase64);
      }
    }
  } catch {
    // Ignore and try base58.
  }

  return decodeBase58(normalized);
};

const decodeTreasurySecret = (rawSecret: string): Uint8Array => {
  const trimmed = rawSecret.trim();
  if (trimmed.length === 0) {
    throw new Error("KINGMYCO_TREASURY_SECRET is empty");
  }

  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error("KINGMYCO_TREASURY_SECRET JSON must be an array");
    }

    const numbers = parsed.map((value) => Number(value));
    if (numbers.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
      throw new Error("KINGMYCO_TREASURY_SECRET JSON array contains invalid byte values");
    }

    return new Uint8Array(numbers);
  }

  try {
    const decoded = decodeBase58(trimmed);
    if (decoded.length > 0) {
      return decoded;
    }
  } catch {
    // Ignore and fall back to base64 path.
  }

  const fromBase64 = Buffer.from(trimmed, "base64");
  if (fromBase64.length > 0) {
    return new Uint8Array(fromBase64);
  }

  throw new Error("Unable to decode KINGMYCO_TREASURY_SECRET");
};

export class SolanaService {
  readonly rpcUrl: string;
  private readonly connection: Connection;

  constructor(
    rpcUrl = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com",
  ) {
    this.rpcUrl = rpcUrl;
    this.connection = new Connection(rpcUrl, "confirmed");
  }

  verifyWalletProof(input: WalletProofInput): SolanaWalletProof {
    const publicKey = this.parsePublicKey(input.walletAddress);
    const messageBytes = new TextEncoder().encode(input.message);
    const signatureBytes = decodeSignature(input.signature);

    const verified = nacl.sign.detached.verify(
      messageBytes,
      signatureBytes,
      publicKey.toBytes(),
    );

    if (!verified) {
      throw new Error("Solana signature verification failed");
    }

    return {
      playerId: input.playerId,
      source: input.source,
      externalId: input.externalId,
      walletAddress: publicKey.toBase58(),
      message: input.message,
      signature: input.signature,
      verified,
      verifiedAt: new Date().toISOString(),
    };
  }

  async getWalletSnapshot(walletAddress: string): Promise<SolanaWalletSnapshot> {
    const publicKey = this.parsePublicKey(walletAddress);

    try {
      const lamports = await this.connection.getBalance(publicKey, "confirmed");
      return {
        walletAddress: publicKey.toBase58(),
        lamports,
        sol: lamports / LAMPORTS_PER_SOL,
        rpcUrl: this.rpcUrl,
        rpcReachable: true,
        fetchedAt: new Date().toISOString(),
      };
    } catch {
      return {
        walletAddress: publicKey.toBase58(),
        lamports: null,
        sol: null,
        rpcUrl: this.rpcUrl,
        rpcReachable: false,
        fetchedAt: new Date().toISOString(),
      };
    }
  }

  async prepareSolTransfer(
    request: SolanaRewardTransferRequest,
  ): Promise<SolanaRewardTransferIntent> {
    const treasuryAddress = process.env.KINGMYCO_TREASURY_WALLET;

    if (!treasuryAddress) {
      throw new Error("KINGMYCO_TREASURY_WALLET is required for transfer intents");
    }

    const treasuryPublicKey = this.parsePublicKey(treasuryAddress);
    const destinationPublicKey = this.parsePublicKey(request.destinationWallet);

    if (!Number.isInteger(request.lamports) || request.lamports <= 0) {
      throw new Error("lamports must be a positive integer");
    }

    let blockhash = FALLBACK_BLOCKHASH;
    let lastValidBlockHeight = 0;

    try {
      const latest = await this.connection.getLatestBlockhash("finalized");
      blockhash = latest.blockhash;
      lastValidBlockHeight = latest.lastValidBlockHeight;
    } catch {
      // Continue with fallback values for offline/local testing.
    }

    const transaction = new Transaction({
      feePayer: treasuryPublicKey,
      blockhash,
      lastValidBlockHeight,
    });

    transaction.add(
      SystemProgram.transfer({
        fromPubkey: treasuryPublicKey,
        toPubkey: destinationPublicKey,
        lamports: request.lamports,
      }),
    );

    if (request.memo && request.memo.trim().length > 0) {
      transaction.add(
        new TransactionInstruction({
          programId: MEMO_PROGRAM,
          data: Buffer.from(request.memo, "utf8"),
          keys: [],
        }),
      );
    }

    const serialized = transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    });

    return {
      id: randomUUID(),
      playerId: request.playerId,
      source: request.source,
      destinationWallet: destinationPublicKey.toBase58(),
      treasuryWallet: treasuryPublicKey.toBase58(),
      lamports: request.lamports,
      sporesDebited: request.sporesDebited ?? 0,
      memo: request.memo,
      blockhash,
      lastValidBlockHeight,
      unsignedTransactionBase64: serialized.toString("base64"),
      status: "prepared",
      createdAt: new Date().toISOString(),
    };
  }

  async submitPreparedTransferIntent(
    intent: SolanaRewardTransferIntent,
  ): Promise<{ txSignature: string }> {
    const signer = this.getTreasurySigner();

    if (signer.publicKey.toBase58() !== intent.treasuryWallet) {
      throw new Error(
        "Treasury signer does not match transfer intent treasury wallet",
      );
    }

    const transaction = Transaction.from(
      Buffer.from(intent.unsignedTransactionBase64, "base64"),
    );

    try {
      const latest = await this.connection.getLatestBlockhash("finalized");
      transaction.recentBlockhash = latest.blockhash;
      transaction.lastValidBlockHeight = latest.lastValidBlockHeight;
    } catch {
      transaction.recentBlockhash = intent.blockhash;
      transaction.lastValidBlockHeight = intent.lastValidBlockHeight;
    }

    transaction.feePayer = signer.publicKey;
    transaction.sign(signer);

    const raw = transaction.serialize();
    const txSignature = await this.connection.sendRawTransaction(raw, {
      skipPreflight: false,
      maxRetries: 3,
    });

    return { txSignature };
  }

  async getTransferSignatureState(
    txSignature: string,
  ): Promise<"pending" | "settled" | "failed"> {
    const statusResponse = await this.connection.getSignatureStatuses(
      [txSignature],
      {
        searchTransactionHistory: true,
      },
    );

    const status = statusResponse.value[0];
    if (!status) {
      return "pending";
    }

    if (status.err) {
      return "failed";
    }

    if (
      status.confirmationStatus === "confirmed" ||
      status.confirmationStatus === "finalized"
    ) {
      return "settled";
    }

    return "pending";
  }

  private getTreasurySigner(): Keypair {
    const rawSecret = process.env.KINGMYCO_TREASURY_SECRET;
    if (!rawSecret) {
      throw new Error("KINGMYCO_TREASURY_SECRET is required to submit transfers");
    }

    const bytes = decodeTreasurySecret(rawSecret);
    if (bytes.length < 64) {
      throw new Error(
        "KINGMYCO_TREASURY_SECRET must decode to at least 64 bytes",
      );
    }

    return Keypair.fromSecretKey(bytes.slice(0, 64));
  }

  private parsePublicKey(walletAddress: string): PublicKey {
    try {
      return new PublicKey(walletAddress);
    } catch {
      throw new Error(`Invalid Solana wallet address: ${walletAddress}`);
    }
  }
}

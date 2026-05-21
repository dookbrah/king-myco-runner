import {
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import bs58 from "bs58";
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

export class SolanaService {
  readonly rpcUrl: string;
  private readonly connection: Connection;

  constructor(rpcUrl = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com") {
    this.rpcUrl = rpcUrl;
    this.connection = new Connection(rpcUrl, "confirmed");
  }

  verifyWalletProof(input: WalletProofInput): SolanaWalletProof {
    const publicKey = this.parsePublicKey(input.walletAddress);
    const messageBytes = new TextEncoder().encode(input.message);

    let signatureBytes: Uint8Array;
    try {
      signatureBytes = bs58.decode(input.signature);
    } catch {
      throw new Error("Invalid base58 signature encoding");
    }

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

    const { blockhash, lastValidBlockHeight } =
      await this.connection.getLatestBlockhash("finalized");

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
      memo: request.memo,
      blockhash,
      lastValidBlockHeight,
      unsignedTransactionBase64: serialized.toString("base64"),
      status: "prepared",
      createdAt: new Date().toISOString(),
    };
  }

  private parsePublicKey(walletAddress: string): PublicKey {
    try {
      return new PublicKey(walletAddress);
    } catch {
      throw new Error(`Invalid Solana wallet address: ${walletAddress}`);
    }
  }
}

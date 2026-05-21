import { Keypair, PublicKey, Transaction } from "@solana/web3.js";

export type TreasurySignerMode = "local-secret" | "remote-hsm";

interface TreasurySigner {
  readonly mode: TreasurySignerMode;
  readonly publicKey: PublicKey;
  signTransaction(transaction: Transaction): Promise<Transaction>;
}

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
    if (
      numbers.some(
        (value) => !Number.isInteger(value) || value < 0 || value > 255,
      )
    ) {
      throw new Error(
        "KINGMYCO_TREASURY_SECRET JSON array contains invalid byte values",
      );
    }

    return new Uint8Array(numbers);
  }

  try {
    const decoded = decodeBase58(trimmed);
    if (decoded.length > 0) {
      return decoded;
    }
  } catch {
    // Ignore and fall back to base64.
  }

  const fromBase64 = Buffer.from(trimmed, "base64");
  if (fromBase64.length > 0) {
    return new Uint8Array(fromBase64);
  }

  throw new Error("Unable to decode KINGMYCO_TREASURY_SECRET");
};

const parseExpectedTreasuryWallet = (): PublicKey | undefined => {
  const raw = process.env.KINGMYCO_TREASURY_WALLET;
  if (!raw) {
    return undefined;
  }

  try {
    return new PublicKey(raw);
  } catch {
    throw new Error(`Invalid KINGMYCO_TREASURY_WALLET: ${raw}`);
  }
};

class LocalSecretTreasurySigner implements TreasurySigner {
  readonly mode: TreasurySignerMode = "local-secret";
  readonly publicKey: PublicKey;

  private readonly keypair: Keypair;

  constructor(expectedPublicKey?: PublicKey) {
    const rawSecret = process.env.KINGMYCO_TREASURY_SECRET;
    if (!rawSecret) {
      throw new Error("KINGMYCO_TREASURY_SECRET is required for local signer mode");
    }

    const bytes = decodeTreasurySecret(rawSecret);
    if (bytes.length < 64) {
      throw new Error("KINGMYCO_TREASURY_SECRET must decode to at least 64 bytes");
    }

    this.keypair = Keypair.fromSecretKey(bytes.slice(0, 64));
    this.publicKey = this.keypair.publicKey;

    if (
      expectedPublicKey &&
      this.publicKey.toBase58() !== expectedPublicKey.toBase58()
    ) {
      throw new Error(
        "Local signer key does not match KINGMYCO_TREASURY_WALLET",
      );
    }
  }

  async signTransaction(transaction: Transaction): Promise<Transaction> {
    transaction.sign(this.keypair);
    return transaction;
  }
}

class RemoteHsmTreasurySigner implements TreasurySigner {
  readonly mode: TreasurySignerMode = "remote-hsm";
  readonly publicKey: PublicKey;

  private readonly endpoint: string;
  private readonly bearerToken?: string;
  private readonly timeoutMs: number;

  constructor(publicKey: PublicKey) {
    const endpoint = process.env.KINGMYCO_TREASURY_SIGNER_ENDPOINT?.trim();
    if (!endpoint) {
      throw new Error(
        "KINGMYCO_TREASURY_SIGNER_ENDPOINT is required for remote-hsm mode",
      );
    }

    this.endpoint = endpoint;
    this.publicKey = publicKey;
    this.bearerToken = process.env.KINGMYCO_TREASURY_SIGNER_BEARER_TOKEN?.trim();
    this.timeoutMs = Number(process.env.KINGMYCO_TREASURY_SIGNER_TIMEOUT_MS ?? 10000);
  }

  async signTransaction(transaction: Transaction): Promise<Transaction> {
    const unsignedTransactionBase64 = transaction
      .serialize({ requireAllSignatures: false, verifySignatures: false })
      .toString("base64");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.bearerToken
            ? { authorization: `Bearer ${this.bearerToken}` }
            : {}),
        },
        body: JSON.stringify({
          unsignedTransactionBase64,
          treasuryWallet: this.publicKey.toBase58(),
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(
          `Remote signer request failed with status ${response.status}: ${body}`,
        );
      }

      const payload = (await response.json()) as {
        signedTransactionBase64?: string;
      };

      if (!payload.signedTransactionBase64) {
        throw new Error(
          "Remote signer response missing signedTransactionBase64",
        );
      }

      const signed = Transaction.from(
        Buffer.from(payload.signedTransactionBase64, "base64"),
      );

      if (!signed.feePayer || !signed.feePayer.equals(this.publicKey)) {
        throw new Error("Remote signer returned transaction with wrong fee payer");
      }

      const signerRecord = signed.signatures.find(({ publicKey }) =>
        publicKey.equals(this.publicKey),
      );
      if (!signerRecord || !signerRecord.signature) {
        throw new Error("Remote signer did not attach treasury signature");
      }

      return signed;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const createTreasurySignerFromEnv = (): TreasurySigner => {
  const mode =
    (process.env.KINGMYCO_TREASURY_SIGNER_MODE as TreasurySignerMode | undefined) ??
    "local-secret";
  const expected = parseExpectedTreasuryWallet();

  if (mode === "local-secret") {
    return new LocalSecretTreasurySigner(expected);
  }

  if (mode === "remote-hsm") {
    if (!expected) {
      throw new Error(
        "KINGMYCO_TREASURY_WALLET is required for remote-hsm signer mode",
      );
    }

    return new RemoteHsmTreasurySigner(expected);
  }

  throw new Error(`Unsupported KINGMYCO_TREASURY_SIGNER_MODE: ${mode}`);
};

export const resolveTreasuryPublicKeyFromEnv = (): PublicKey => {
  const expected = parseExpectedTreasuryWallet();
  if (expected) {
    return expected;
  }

  const mode =
    (process.env.KINGMYCO_TREASURY_SIGNER_MODE as TreasurySignerMode | undefined) ??
    "local-secret";

  if (mode === "local-secret") {
    const signer = new LocalSecretTreasurySigner();
    return signer.publicKey;
  }

  throw new Error(
    "KINGMYCO_TREASURY_WALLET must be set when using remote-hsm signer mode",
  );
};

import { createHmac, timingSafeEqual } from "node:crypto";

const normalizeHeader = (
  header: string | string[] | undefined,
): string | undefined => {
  if (!header) {
    return undefined;
  }

  return Array.isArray(header) ? header[0] : header;
};

const constantTimeEquals = (left: string, right: string): boolean => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
};

export class WebhookVerifier {
  constructor(
    private readonly telegramSecret?: string,
    private readonly openClawSecret?: string,
    private readonly maxClockDriftSec = 300,
  ) {}

  verifyTelegramHeader(header: string | string[] | undefined): boolean {
    if (!this.telegramSecret) {
      return true;
    }

    const received = normalizeHeader(header);
    if (!received) {
      return false;
    }

    return constantTimeEquals(received, this.telegramSecret);
  }

  verifyOpenClawSignature(
    rawBody: string,
    signatureHeader: string | string[] | undefined,
    timestampHeader: string | string[] | undefined,
  ): boolean {
    if (!this.openClawSecret) {
      return true;
    }

    const receivedTimestamp = normalizeHeader(timestampHeader);
    const receivedSignatureRaw = normalizeHeader(signatureHeader);

    if (!receivedTimestamp || !receivedSignatureRaw) {
      return false;
    }

    const unixTimestamp = Number(receivedTimestamp);
    if (!Number.isFinite(unixTimestamp)) {
      return false;
    }

    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - unixTimestamp) > this.maxClockDriftSec) {
      return false;
    }

    const expected = createHmac("sha256", this.openClawSecret)
      .update(`${receivedTimestamp}.${rawBody}`)
      .digest("hex");

    const normalizedReceived = receivedSignatureRaw.startsWith("sha256=")
      ? receivedSignatureRaw.slice("sha256=".length)
      : receivedSignatureRaw;

    return constantTimeEquals(normalizedReceived, expected);
  }
}

const MYCO_MINT = "9BySdih23rwDPZB8auQXX9k5u6a2Nk4GSDji2MB6pump";
const REQUIRED_MYCO = 10_000;
const MYCO_DECIMALS = 6;
const RPC_URLS = [
  "https://api.mainnet-beta.solana.com",
  "https://solana-mainnet.g.alchemy.com/v2/demo",
];

interface PhantomProvider {
  isPhantom?: boolean;
  connect: () => Promise<{ publicKey?: { toBase58?: () => string; toString?: () => string } }>;
}

function getPhantom(): PhantomProvider | null {
  const w = window as unknown as { solana?: PhantomProvider; phantom?: { solana?: PhantomProvider } };
  return w.phantom?.solana ?? w.solana ?? null;
}

export async function connectWallet(): Promise<string | null> {
  const provider = getPhantom();
  if (provider?.isPhantom) {
    try {
      const response = await provider.connect();
      return response?.publicKey?.toBase58?.() ?? response?.publicKey?.toString?.() ?? null;
    } catch (_e) {
      return null;
    }
  }
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (isMobile) {
    window.open("https://phantom.app/ul/browse/" + encodeURIComponent(window.location.href), "_blank");
  }
  return null;
}

async function rpcCall(method: string, params: unknown[]): Promise<unknown> {
  for (const url of RPC_URLS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      const data = await res.json();
      if (data?.result !== undefined) return data;
    } catch (_e) {
      continue;
    }
  }
  return { result: null };
}

export async function checkMycoBalance(walletAddress: string): Promise<{ balance: number; hasEnough: boolean; method: string }> {
  // Method 1: Direct mint filter
  try {
    const data = await rpcCall("getTokenAccountsByOwner", [
      walletAddress,
      { mint: MYCO_MINT },
      { encoding: "jsonParsed", commitment: "confirmed" },
    ]) as { result?: { value?: Array<{ account?: { data?: { parsed?: { info?: { tokenAmount?: { uiAmount?: number; amount?: string } } } } } }> } };

    const accounts = data?.result?.value ?? [];
    console.log(`[MYCO] Method 1 (mint filter): found ${accounts.length} accounts`);

    if (accounts.length > 0) {
      let total = 0;
      for (const account of accounts) {
        const info = account?.account?.data?.parsed?.info?.tokenAmount;
        const uiAmount = info?.uiAmount ?? 0;
        const rawAmount = info?.amount ? Number(info.amount) / Math.pow(10, MYCO_DECIMALS) : 0;
        const amount = uiAmount > 0 ? uiAmount : rawAmount;
        console.log(`[MYCO] Account balance: uiAmount=${uiAmount}, raw=${info?.amount}, computed=${amount}`);
        total += amount;
      }
      return { balance: Math.floor(total), hasEnough: total >= REQUIRED_MYCO, method: "mint-filter" };
    }
  } catch (e) {
    console.warn("[MYCO] Method 1 failed:", e);
  }

  // Method 2: Scan all token accounts for this wallet
  try {
    const data = await rpcCall("getTokenAccountsByOwner", [
      walletAddress,
      { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
      { encoding: "jsonParsed", commitment: "confirmed" },
    ]) as { result?: { value?: Array<{ account?: { data?: { parsed?: { info?: { mint?: string; tokenAmount?: { uiAmount?: number; amount?: string } } } } } }> } };

    const accounts = data?.result?.value ?? [];
    console.log(`[MYCO] Method 2 (all SPL accounts): found ${accounts.length} total token accounts`);

    let total = 0;
    for (const account of accounts) {
      const info = account?.account?.data?.parsed?.info;
      const mint = info?.mint ?? "";
      if (mint === MYCO_MINT) {
        const uiAmount = info?.tokenAmount?.uiAmount ?? 0;
        const rawAmount = info?.tokenAmount?.amount ? Number(info.tokenAmount.amount) / Math.pow(10, MYCO_DECIMALS) : 0;
        const amount = uiAmount > 0 ? uiAmount : rawAmount;
        console.log(`[MYCO] Found MYCO account: ${amount} tokens`);
        total += amount;
      }
    }

    if (total > 0) {
      return { balance: Math.floor(total), hasEnough: total >= REQUIRED_MYCO, method: "all-accounts" };
    }

    // Log all mints found for debugging
    const mints = new Set(accounts.map((a) => a?.account?.data?.parsed?.info?.mint).filter(Boolean));
    console.log(`[MYCO] All mints in wallet:`, [...mints].slice(0, 20));
    console.log(`[MYCO] Looking for mint: ${MYCO_MINT}`);
  } catch (e) {
    console.warn("[MYCO] Method 2 failed:", e);
  }

  // Method 3: Check if MYCO uses a different mint representation
  // Some pump.fun tokens have case-sensitive addresses
  try {
    const data = await rpcCall("getTokenAccountsByOwner", [
      walletAddress,
      { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
      { encoding: "jsonParsed", commitment: "confirmed" },
    ]) as { result?: { value?: Array<{ account?: { data?: { parsed?: { info?: { mint?: string; tokenAmount?: { uiAmount?: number; amount?: string } } } } } }> } };

    for (const account of data?.result?.value ?? []) {
      const info = account?.account?.data?.parsed?.info;
      const mint = info?.mint ?? "";
      const amount = info?.tokenAmount?.uiAmount ?? 0;
      // Match by prefix (pump.fun addresses)
      if (amount > 1000 && mint.endsWith("pump")) {
        console.log(`[MYCO] Method 3 found pump token: mint=${mint} amount=${amount}`);
        if (mint === MYCO_MINT) {
          return { balance: Math.floor(amount), hasEnough: amount >= REQUIRED_MYCO, method: "pump-scan" };
        }
      }
    }
  } catch (e) {
    console.warn("[MYCO] Method 3 failed:", e);
  }

  return { balance: 0, hasEnough: false, method: "not-found" };
}

export const MYCO_TOKEN_MINT = MYCO_MINT;
export const MYCO_REQUIRED_AMOUNT = REQUIRED_MYCO;

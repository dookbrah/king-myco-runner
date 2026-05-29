const MYCO_MINT = "9BySdih23rwDPZB8auQXX9k5u6a2Nk4GSDji2MB6pump";
const REQUIRED_MYCO = 10_000;
const RPC_URL = "https://api.mainnet-beta.solana.com";

const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

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
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return res.json();
}

async function getTokenBalanceForProgram(walletAddress: string, programId: string): Promise<number> {
  try {
    const data = await rpcCall("getTokenAccountsByOwner", [
      walletAddress,
      { mint: MYCO_MINT },
      { encoding: "jsonParsed", commitment: "confirmed" },
    ]) as { result?: { value?: Array<{ account?: { data?: { parsed?: { info?: { tokenAmount?: { uiAmount?: number } } } } } }> } };

    let total = 0;
    for (const account of data?.result?.value ?? []) {
      total += account?.account?.data?.parsed?.info?.tokenAmount?.uiAmount ?? 0;
    }
    return total;
  } catch (_e) {
    return 0;
  }
}

async function getTokenBalanceByAccounts(walletAddress: string): Promise<number> {
  try {
    const data = await rpcCall("getTokenAccountsByOwner", [
      walletAddress,
      { programId: TOKEN_PROGRAM },
      { encoding: "jsonParsed", commitment: "confirmed" },
    ]) as { result?: { value?: Array<{ account?: { data?: { parsed?: { info?: { mint?: string; tokenAmount?: { uiAmount?: number } } } } } }> } };

    let total = 0;
    for (const account of data?.result?.value ?? []) {
      const info = account?.account?.data?.parsed?.info;
      if (info?.mint === MYCO_MINT) {
        total += info?.tokenAmount?.uiAmount ?? 0;
      }
    }

    if (total > 0) return total;

    const data2022 = await rpcCall("getTokenAccountsByOwner", [
      walletAddress,
      { programId: TOKEN_2022_PROGRAM },
      { encoding: "jsonParsed", commitment: "confirmed" },
    ]) as { result?: { value?: Array<{ account?: { data?: { parsed?: { info?: { mint?: string; tokenAmount?: { uiAmount?: number } } } } } }> } };

    for (const account of data2022?.result?.value ?? []) {
      const info = account?.account?.data?.parsed?.info;
      if (info?.mint === MYCO_MINT) {
        total += info?.tokenAmount?.uiAmount ?? 0;
      }
    }

    return total;
  } catch (_e) {
    return 0;
  }
}

export async function checkMycoBalance(walletAddress: string): Promise<{ balance: number; hasEnough: boolean }> {
  let balance = await getTokenBalanceForProgram(walletAddress, TOKEN_PROGRAM);

  if (balance === 0) {
    balance = await getTokenBalanceByAccounts(walletAddress);
  }

  return {
    balance: Math.floor(balance),
    hasEnough: balance >= REQUIRED_MYCO,
  };
}

export const MYCO_TOKEN_MINT = MYCO_MINT;
export const MYCO_REQUIRED_AMOUNT = REQUIRED_MYCO;

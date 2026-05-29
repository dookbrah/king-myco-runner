const MYCO_MINT = "9BySdih23rwDPZB8auQXX9k5u6a2Nk4GSDji2MB6pump";
const REQUIRED_MYCO = 10_000;
const RPC_URL = "https://api.mainnet-beta.solana.com";

interface PhantomProvider {
  isPhantom?: boolean;
  connect: () => Promise<{ publicKey?: { toBase58?: () => string; toString?: () => string } }>;
  signMessage?: (message: Uint8Array, encoding: string) => Promise<{ signature: Uint8Array }>;
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

export async function checkMycoBalance(walletAddress: string): Promise<{ balance: number; hasEnough: boolean }> {
  try {
    const body = {
      jsonrpc: "2.0",
      id: 1,
      method: "getTokenAccountsByOwner",
      params: [
        walletAddress,
        { mint: MYCO_MINT },
        { encoding: "jsonParsed" },
      ],
    };

    const res = await fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await res.json() as {
      result?: {
        value?: Array<{
          account?: {
            data?: {
              parsed?: {
                info?: {
                  tokenAmount?: {
                    uiAmount?: number;
                  };
                };
              };
            };
          };
        }>;
      };
    };

    const accounts = data?.result?.value ?? [];
    let totalBalance = 0;
    for (const account of accounts) {
      const amount = account?.account?.data?.parsed?.info?.tokenAmount?.uiAmount ?? 0;
      totalBalance += amount;
    }

    return {
      balance: Math.floor(totalBalance),
      hasEnough: totalBalance >= REQUIRED_MYCO,
    };
  } catch (_e) {
    return { balance: 0, hasEnough: false };
  }
}

export const MYCO_TOKEN_MINT = MYCO_MINT;
export const MYCO_REQUIRED_AMOUNT = REQUIRED_MYCO;

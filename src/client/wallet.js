// Minimal browser-wallet glue (MetaMask or any EIP-1193 wallet). No library:
// the server hands us ready-made transactions, we only ask the wallet to
// sign the link message and send the collect transaction.
import { CHAIN } from '../shared/chain.js';

const eth = () => window.ethereum;
export const hasWallet = () => !!eth();

export async function connect() {
  const [address] = await eth().request({ method: 'eth_requestAccounts' });
  return address;
}

const toHex = (text) => `0x${[...new TextEncoder().encode(text)].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
export const signMessage = (address, message) => eth().request({ method: 'personal_sign', params: [toHex(message), address] });

export async function ensureChain(chainId) {
  const hexId = `0x${chainId.toString(16)}`;
  try {
    await eth().request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hexId }] });
  } catch (e) {
    if (e?.code !== 4902) throw e; // 4902: wallet doesn't know this chain yet
    await eth().request({
      method: 'wallet_addEthereumChain',
      params: [{ chainId: hexId, chainName: CHAIN.name, nativeCurrency: CHAIN.currency, rpcUrls: [CHAIN.rpc], blockExplorerUrls: [CHAIN.explorer] }],
    });
  }
}

export async function sendTx(from, tx) {
  await ensureChain(tx.chainId);
  return eth().request({ method: 'eth_sendTransaction', params: [{ from, to: tx.to, data: tx.data }] });
}

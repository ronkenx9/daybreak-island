// Shared test helper: a local fork of Robinhood Chain testnet with a freshly
// deployed PrizeVault holding real stock tokens.
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createPublicClient, createWalletClient, encodeAbiParameters, erc20Abi, http, keccak256, numberToHex, parseEther } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { CHAIN, STOCK_TOKENS } from '../src/shared/chain.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// the stock tokens are OpenZeppelin upgradeable ERC20s: balances live in the ERC-7201 namespace
const ERC20_NS = '0x52c63247e1f47db19d5ce0460030c497f067ca4cebf71ba98eeadabe20bace00';

export async function startFork({ port = 8547, walletClaimsPerDay = 2n } = {}) {
  const RPC = `http://127.0.0.1:${port}`;
  const chain = { id: CHAIN.id, name: 'rh-fork', nativeCurrency: CHAIN.currency, rpcUrls: { default: { http: [RPC] } } };
  const pub = createPublicClient({ chain, transport: http(RPC) });
  execFileSync('forge', ['build', '--silent'], { cwd: 'contracts' });
  const anvil = spawn('anvil', ['--fork-url', CHAIN.rpc, '--port', String(port), '--silent'], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { await pub.getChainId(); break; } catch { await wait(500); } }
  if (await pub.getChainId() !== CHAIN.id) throw new Error('fork has the wrong chain id');
  const rpc = (method, params) => pub.request({ method, params });
  const fundEth = (addr) => rpc('anvil_setBalance', [addr, numberToHex(parseEther('10'))]);
  const setTokenBalance = (token, who, amount) => rpc('anvil_setStorageAt', [token, keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'bytes32' }], [who, ERC20_NS])), numberToHex(amount, { size: 32 })]);
  const wallet = (account) => createWalletClient({ account, chain, transport: http(RPC) });

  const admin = privateKeyToAccount(generatePrivateKey());
  const guardian = privateKeyToAccount(generatePrivateKey());
  const signerKey = generatePrivateKey();
  const signer = privateKeyToAccount(signerKey);
  for (const a of [admin, guardian]) await fundEth(a.address);
  const artifact = JSON.parse(readFileSync('contracts/out/PrizeVault.sol/PrizeVault.json', 'utf8'));
  const deployTx = await wallet(admin).deployContract({ abi: artifact.abi, bytecode: artifact.bytecode.object, args: [admin.address, guardian.address, signer.address, walletClaimsPerDay] });
  const vault = (await pub.waitForTransactionReceipt({ hash: deployTx })).contractAddress;
  for (const token of Object.values(STOCK_TOKENS)) {
    const h = await wallet(admin).writeContract({ address: vault, abi: artifact.abi, functionName: 'setDailyCap', args: [token, parseEther('5')] });
    await pub.waitForTransactionReceipt({ hash: h });
    await setTokenBalance(token, vault, parseEther('50'));
  }
  const balanceOf = (ticker, who) => pub.readContract({ address: STOCK_TOKENS[ticker], abi: erc20Abi, functionName: 'balanceOf', args: [who] });
  return { RPC, chain, pub, rpc, fundEth, wallet, admin, guardian, signerKey, vault, artifact, balanceOf, close: () => anvil.kill() };
}

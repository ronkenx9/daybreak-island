// G15: the deployed vault on Robinhood Chain testnet matches deploy/vault.json
// and holds prize stock.
//   node scripts/check-vault.mjs
import { readFileSync } from 'node:fs';
import { createPublicClient, erc20Abi, formatEther, http } from 'viem';
import { CHAIN, STOCK_TOKENS, VAULT_ABI } from '../src/shared/chain.js';

const rec = JSON.parse(readFileSync('deploy/vault.json', 'utf8'));
const pub = createPublicClient({ chain: { id: CHAIN.id, name: CHAIN.name, nativeCurrency: CHAIN.currency, rpcUrls: { default: { http: [CHAIN.rpc] } } }, transport: http() });
const read = (functionName, args = []) => pub.readContract({ address: rec.vault, abi: VAULT_ABI, functionName, args });
const problems = [];
if (await pub.getChainId() !== CHAIN.id) problems.push('wrong chain');
if (!(await pub.getCode({ address: rec.vault }))?.length) problems.push('no contract at vault address');
const signer = await read('signer');
if (signer.toLowerCase() !== rec.signer.toLowerCase()) problems.push(`signer is ${signer}`);
if (!(await read('hasRole', [await read('GUARDIAN_ROLE'), rec.guardian]))) problems.push('guardian role missing');
if (!(await read('hasRole', ['0x' + '00'.repeat(32), rec.admin]))) problems.push('admin role missing');
if (await read('paused')) problems.push('vault is paused');
let stocked = 0;
for (const [ticker, token] of Object.entries(STOCK_TOKENS)) {
  const [cap, bal] = await Promise.all([read('dailyCap', [token]), pub.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [rec.vault] })]);
  if (cap === 0n) problems.push(`${ticker} has no daily cap (not a prize)`);
  if (bal > 0n) stocked++;
  console.log(`${ticker}: cap ${formatEther(cap)}/day, vault holds ${formatEther(bal)}`);
}
if (!stocked) problems.push('vault holds no stock yet (fund it from the faucet)');
console.log(`vault ${rec.vault} signer ${signer} guardian ${rec.guardian} admin ${rec.admin}`);
for (const p of problems) console.log(`  problem: ${p}`);
console.log(problems.length ? 'VAULT FAILED' : 'VAULT OK');
process.exit(problems.length ? 1 : 0);

// Deploy the PrizeVault to Robinhood Chain testnet and set it up.
//   agent-keys run daybreak-prizes -- node scripts/deploy-vault.mjs
// env:
//   DEPLOYER_KEY      pays gas, becomes admin unless ADMIN_ADDRESS is set
//   SIGNER_ADDRESS    address the game server signs vouchers with (or SIGNER_KEY)
//   GUARDIAN_ADDRESS  can pause/revoke (or GUARDIAN_KEY)
//   ADMIN_ADDRESS     optional: a different admin (e.g. your own wallet or multisig)
//   DAILY_CAP         per-token daily cap in whole tokens (default 5)
//   WALLET_PER_DAY    collections per wallet per day, on-chain backstop (default 2;
//                     the server itself issues at most 1 per wallet per day)
// Any stock tokens the deployer holds (from the faucet) are moved into the vault.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createPublicClient, createWalletClient, erc20Abi, http, parseEther, formatEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { CHAIN, STOCK_TOKENS } from '../src/shared/chain.js';

const env = process.env;
const chain = { id: CHAIN.id, name: CHAIN.name, nativeCurrency: CHAIN.currency, rpcUrls: { default: { http: [env.CHAIN_RPC || CHAIN.rpc] } } };
const pub = createPublicClient({ chain, transport: http() });
const deployer = privateKeyToAccount(env.DEPLOYER_KEY);
const w = createWalletClient({ account: deployer, chain, transport: http() });
const addr = (a, k) => a || (k ? privateKeyToAccount(k).address : null);
const signer = addr(env.SIGNER_ADDRESS, env.SIGNER_KEY);
const guardian = addr(env.GUARDIAN_ADDRESS, env.GUARDIAN_KEY);
const admin = env.ADMIN_ADDRESS || deployer.address;
if (!signer || !guardian) throw new Error('need SIGNER_ADDRESS/SIGNER_KEY and GUARDIAN_ADDRESS/GUARDIAN_KEY');
const cap = parseEther(env.DAILY_CAP || '5');

const gas = await pub.getBalance({ address: deployer.address });
console.log(`deployer ${deployer.address} has ${formatEther(gas)} ETH`);
if (gas === 0n) { console.log(`fund it first: ${CHAIN.faucet}`); process.exit(1); }

execFileSync('forge', ['build', '--silent'], { cwd: 'contracts' });
const art = JSON.parse(readFileSync('contracts/out/PrizeVault.sol/PrizeVault.json', 'utf8'));
const wait = (hash) => pub.waitForTransactionReceipt({ hash });
// deploy with the deployer as admin first so it can configure, then hand over
const rc = await wait(await w.deployContract({ abi: art.abi, bytecode: art.bytecode.object, args: [deployer.address, guardian, signer, BigInt(env.WALLET_PER_DAY || 2)] }));
const vault = rc.contractAddress;
console.log(`vault ${vault}  (${CHAIN.explorer}/address/${vault})`);
for (const [ticker, token] of Object.entries(STOCK_TOKENS)) {
  await wait(await w.writeContract({ address: vault, abi: art.abi, functionName: 'setDailyCap', args: [token, cap] }));
  const bal = await pub.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [deployer.address] });
  if (bal > 0n) {
    await wait(await w.writeContract({ address: token, abi: erc20Abi, functionName: 'approve', args: [vault, bal] }));
    await wait(await w.writeContract({ address: vault, abi: art.abi, functionName: 'fund', args: [token, bal] }));
  }
  console.log(`  ${ticker}: cap ${formatEther(cap)}/day, funded ${formatEther(bal)}`);
}
if (admin.toLowerCase() !== deployer.address.toLowerCase()) {
  const ADMIN = '0x0000000000000000000000000000000000000000000000000000000000000000';
  await wait(await w.writeContract({ address: vault, abi: art.abi, functionName: 'grantRole', args: [ADMIN, admin] }));
  await wait(await w.writeContract({ address: vault, abi: art.abi, functionName: 'renounceRole', args: [ADMIN, deployer.address] }));
  console.log(`admin handed to ${admin}`);
}
mkdirSync('deploy', { recursive: true });
const record = { chainId: CHAIN.id, vault, admin, guardian, signer, dailyCap: formatEther(cap), walletClaimsPerDay: Number(env.WALLET_PER_DAY || 2), deployedAt: new Date().toISOString(), tx: rc.transactionHash };
writeFileSync('deploy/vault.json', `${JSON.stringify(record, null, 2)}\n`);
console.log('wrote deploy/vault.json');

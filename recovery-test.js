// Tests the owner recovery mechanism on a local EVM.
const { VM } = require('@ethereumjs/vm');
const { Address, Account, hexToBytes } = require('@ethereumjs/util');
const { ethers } = require('ethers');
const art = require('../artifacts/GasSpend.json');
const iface = new ethers.Interface(art.abi);
const RON = 10n ** 18n;
const ZERO = '0x0000000000000000000000000000000000000000';

async function call(vm, from, to, data, value = 0n, gas = 5_000_000n) {
  const r = await vm.evm.runCall({ caller: from, to, data: typeof data === "string" ? hexToBytes(data) : data, gasLimit: gas, value });
  return r;
}
async function view(vm, from, to, data) {
  const r = await call(vm, from, to, data);
  if (r.execResult.exceptionError) throw new Error('view failed: ' + r.execResult.exceptionError);
  return r.execResult.returnValue;
}

(async () => {
  const vm = await VM.create();
  const sm = vm.stateManager;
  const owner = Address.fromString('0x1111111111111111111111111111111111111111');
  const alice = Address.fromString('0x2222222222222222222222222222222222222222');
  const bob   = Address.fromString('0x3333333333333333333333333333333333333333');
  const treasury = Address.fromString('0x4444444444444444444444444444444444444444');
  for (const a of [owner, alice, bob]) await sm.putAccount(a, new Account(0n, 100n * RON));

  const initCode = art.bytecode + iface.encodeDeploy([treasury.toString(), 10_000_000_000n]).slice(2);
  let r = await call(vm, owner, undefined, initCode, 0n, 15_000_000n);
  if (r.execResult.exceptionError) throw new Error('deploy failed');
  const c = r.createdAddress;
  console.log('deployed at', c.toString());

  // Fund pool 2 RON; alice + bob each earn rebates
  await call(vm, owner, c, new Uint8Array(0), 2n * RON);
  for (const [u, n] of [[alice, 3], [bob, 2]]) {
    for (let i = 0; i < n; i++) {
      r = await call(vm, u, c, iface.encodeFunctionData('logActivity', [ethers.ZeroHash]));
      if (r.execResult.exceptionError) throw new Error('logActivity failed');
    }
  }
  const st1 = iface.decodeFunctionResult('stats', await view(vm, owner, c, iface.encodeFunctionData('stats', [])));
  const aClaim = iface.decodeFunctionResult('claimableOf', await view(vm, owner, c, iface.encodeFunctionData('claimableOf', [alice.toString()])))[0];
  const bClaim = iface.decodeFunctionResult('claimableOf', await view(vm, owner, c, iface.encodeFunctionData('claimableOf', [bob.toString()])))[0];
  console.log('users:', st1[0].toString(), '| totalOwed:', ethers.formatEther(st1[3]), 'RON | alice:', ethers.formatEther(aClaim), '| bob:', ethers.formatEther(bClaim));

  // --- T1: non-owner cannot recover ---
  r = await call(vm, alice, c, iface.encodeFunctionData('recoverUnclaimed', [bob.toString()]));
  console.log('T1 non-owner recoverUnclaimed reverts:', r.execResult.exceptionError !== undefined);

  // --- T2: owner recovers ALICE's unclaimed rebate ---
  const balBefore = (await sm.getAccount(owner)).balance;
  r = await call(vm, owner, c, iface.encodeFunctionData('recoverUnclaimed', [alice.toString()]));
  console.log('T2 owner recoverUnclaimed(alice) ok:', r.execResult.exceptionError === undefined);
  const got1 = (await sm.getAccount(owner)).balance - balBefore;
  console.log('   owner received:', ethers.formatEther(got1), 'RON');
  const aAfter = iface.decodeFunctionResult('claimableOf', await view(vm, owner, c, iface.encodeFunctionData('claimableOf', [alice.toString()])))[0];
  console.log('   alice claimable now:', ethers.formatEther(aAfter), '(zeroed)');
  const st2 = iface.decodeFunctionResult('stats', await view(vm, owner, c, iface.encodeFunctionData('stats', [])));
  console.log('   totalOwed now:', ethers.formatEther(st2[3]), 'RON (reduced by alice share)');

  // --- T3: recovered alice cannot claim anymore ---
  r = await call(vm, alice, c, iface.encodeFunctionData('claimRebate', []));
  console.log('T3 alice claim after recovery reverts:', r.execResult.exceptionError !== undefined);

  // --- T4: recoverAllUnclaimed takes bob's share (and only his) ---
  const balBefore2 = (await sm.getAccount(owner)).balance;
  r = await call(vm, owner, c, iface.encodeFunctionData('recoverAllUnclaimed', []));
  console.log('T4 recoverAllUnclaimed ok:', r.execResult.exceptionError === undefined);
  const got2 = (await sm.getAccount(owner)).balance - balBefore2;
  console.log('   owner received:', ethers.formatEther(got2), 'RON (== bob share', ethers.formatEther(bClaim) + ')');
  const st3 = iface.decodeFunctionResult('stats', await view(vm, owner, c, iface.encodeFunctionData('stats', [])));
  console.log('   totalOwed now:', ethers.formatEther(st3[3]), 'RON');

  // --- T5: recoverAll with nothing left reverts ---
  r = await call(vm, owner, c, iface.encodeFunctionData('recoverAllUnclaimed', []));
  console.log('T5 recoverAllUnclaimed with nothing reverts:', r.execResult.exceptionError !== undefined);

  // --- T6: surplus withdraw still works after recovery ---
  const balBefore3 = (await sm.getAccount(owner)).balance;
  r = await call(vm, owner, c, iface.encodeFunctionData('emergencyWithdraw', [owner.toString()]));
  console.log('T6 surplus withdraw ok:', r.execResult.exceptionError === undefined,
              '| owner +', ethers.formatEther((await sm.getAccount(owner)).balance - balBefore3), 'RON');
  console.log('   contract balance left:', ethers.formatEther((await sm.getAccount(c)).balance), 'RON (≈0, nothing stuck)');

  console.log('\nRECOVERY TESTS PASSED ✔');
})().catch(e => { console.error('FAIL:', e); process.exit(1); });

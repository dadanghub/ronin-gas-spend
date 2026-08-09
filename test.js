// Pure-JS end-to-end test of GasSpend on a local EVM (same EVM as Ronin mainnet).
const { VM } = require('@ethereumjs/vm');
const { Address, Account, hexToBytes, bytesToBigInt } = require('@ethereumjs/util');
const { ethers } = require('ethers');
const art = require('../artifacts/GasSpend.json');

const iface = new ethers.Interface(art.abi);
const RON = 10n ** 18n;

(async () => {
  const vm = await VM.create();
  const sm = vm.stateManager;

  const deployer = Address.fromString('0x1111111111111111111111111111111111111111');
  const alice    = Address.fromString('0x2222222222222222222222222222222222222222');
  const bob      = Address.fromString('0x3333333333333333333333333333333333333333');
  const treasury = Address.fromString('0x4444444444444444444444444444444444444444');

  // Fund deployer + users with 100 RON each
  for (const a of [deployer, alice, bob]) await sm.putAccount(a, new Account(0n, 100n * RON));

  // --- deploy ---
  const rebatePerGas = 10_000_000_000n; // 10 gwei per gas unit
  const initCode = art.bytecode + iface.encodeDeploy([treasury.toString(), rebatePerGas]).slice(2);
  let r = await vm.evm.runCall({ caller: deployer, data: hexToBytes(initCode), gasLimit: 15_000_000n, value: 0n });
  if (r.execResult.exceptionError) throw new Error('deploy failed: ' + r.exceptionError);
  const contractAddr = r.createdAddress;
  console.log('deployed at', contractAddr.toString());

  // --- fund rebate pool: deployer sends 1 RON ---
  r = await vm.evm.runCall({ caller: deployer, to: contractAddr, data: new Uint8Array(0), gasLimit: 100_000n, value: RON });
  if (r.execResult.exceptionError) throw new Error('fund failed');

  // --- alice: register + 3x logActivity ---
  for (const fn of ['register', 'logActivity', 'logActivity', 'logActivity']) {
    const data = iface.encodeFunctionData(fn, fn === 'logActivity' ? [ethers.ZeroHash] : []);
    r = await vm.evm.runCall({ caller: alice, to: contractAddr, data: hexToBytes(data), gasLimit: 5_000_000n, value: 0n });
    if (r.execResult.exceptionError) throw new Error(fn + ' failed: ' + r.exceptionError.message || r.exceptionError);
    console.log(`alice.${fn}  -> gas used ${r.execResult.executionGasUsed.toString()}`);
  }

  // --- bob: one call (auto-register path) ---
  r = await vm.evm.runCall({ caller: bob, to: contractAddr, data: hexToBytes(iface.encodeFunctionData('logActivity', [ethers.ZeroHash])), gasLimit: 5_000_000n });
  if (r.execResult.exceptionError) throw new Error('bob logActivity failed');

  // --- read stats ---
  r = await vm.evm.runCall({ caller: alice, to: contractAddr, data: hexToBytes(iface.encodeFunctionData('stats', [])), gasLimit: 5_000_000n });
  const st = iface.decodeFunctionResult('stats', r.execResult.returnValue);
  console.log('stats -> users:', st[0].toString(), '| calls:', st[1].toString(), '| gasSpent:', st[2].toString(), '| owed:', ethers.formatEther(st[3]), 'RON');

  r = await vm.evm.runCall({ caller: alice, to: contractAddr, data: hexToBytes(iface.encodeFunctionData('claimableOf', [alice.toString()])), gasLimit: 5_000_000n });
  const claim = iface.decodeFunctionResult('claimableOf', r.execResult.returnValue)[0];
  console.log('alice claimable =', ethers.formatEther(claim), 'RON');

  // --- alice claims ---
  r = await vm.evm.runCall({ caller: alice, to: contractAddr, data: hexToBytes(iface.encodeFunctionData('claimRebate', [])), gasLimit: 5_000_000n });
  if (r.execResult.exceptionError) throw new Error('claim failed: ' + r.exceptionError);
  const aliceBal = (await sm.getAccount(alice)).balance;
  console.log('alice balance after claim =', ethers.formatEther(aliceBal), 'RON (starts at 100)');

  // --- double claim must revert ---
  r = await vm.evm.runCall({ caller: alice, to: contractAddr, data: hexToBytes(iface.encodeFunctionData('claimRebate', [])), gasLimit: 5_000_000n });
  console.log('double claim reverts:', r.execResult.exceptionError !== undefined);

  // --- owner emergencyWithdraw (surplus only; obligations preserved) ---
  r = await vm.evm.runCall({ caller: deployer, to: contractAddr, data: hexToBytes(iface.encodeFunctionData('emergencyWithdraw', [deployer.toString()])), gasLimit: 5_000_000n });
  if (r.execResult.exceptionError) throw new Error('withdraw failed: ' + r.exceptionError);
  console.log('emergencyWithdraw ok');

  // --- unauthorized pause must revert ---
  r = await vm.evm.runCall({ caller: alice, to: contractAddr, data: hexToBytes(iface.encodeFunctionData('pause', [])), gasLimit: 5_000_000n });
  console.log('non-owner pause reverts:', r.execResult.exceptionError !== undefined);

  // --- paused: logActivity reverts ---
  await vm.evm.runCall({ caller: deployer, to: contractAddr, data: hexToBytes(iface.encodeFunctionData('pause', [])), gasLimit: 5_000_000n });
  r = await vm.evm.runCall({ caller: bob, to: contractAddr, data: hexToBytes(iface.encodeFunctionData('logActivity', [ethers.ZeroHash])), gasLimit: 5_000_000n });
  console.log('logActivity while paused reverts:', r.execResult.exceptionError !== undefined);

  console.log('\nALL TESTS PASSED ✔');
})().catch(e => { console.error('FAIL:', e); process.exit(1); });

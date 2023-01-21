const deploymentHelper = require('../utils/deploymentHelpers.js')
const testHelpers = require('../utils/testHelpers.js')
const th = testHelpers.TestHelper
const dec = th.dec
const toBN = th.toBN
const mv = testHelpers.MoneyValues
const timeValues = testHelpers.TimeValues

const DCHFTokenTester = artifacts.require('DCHFTokenTester')
const TroveManagerTester = artifacts.require('TroveManagerTester')
const TroveManagerHelpersTester = artifacts.require('TroveManagerHelpersTester')
const NonPayable = artifacts.require('NonPayable.sol')
const StabilityPool = artifacts.require('StabilityPool.sol')

const ZERO = toBN('0')
const ZERO_ADDRESS = th.ZERO_ADDRESS
const maxBytes32 = th.maxBytes32

contract('StabilityPool', async (accounts) => {
  const [
    owner,
    defaulter_1,
    defaulter_2,
    defaulter_3,
    whale,
    alice,
    bob,
    carol,
    dennis,
    erin,
    flyn,
    A,
    B,
    C,
    D,
    E,
    F,
  ] = accounts

  const [bountyAddress, lpRewardsAddress, multisig] = accounts.slice(997, 1000)

  let contracts
  let priceFeed
  let dchfToken
  let sortedTroves
  let troveManager
  let troveManagerHelpers
  let activePool
  let stabilityPool
  let stabilityPoolERC20
  let defaultPool
  let borrowerOperations
  let monToken
  let communityIssuance
  let erc20

  let gasPriceInWei

  const getOpenTroveDCHFAmount = async (totalDebt, asset) =>
    th.getOpenTroveDCHFAmount(contracts, totalDebt, asset)
  const openTrove = async (params) => th.openTrove(contracts, params)
  const assertRevert = th.assertRevert

  describe('Stability Pool Mechanisms', async () => {
    before(async () => {
      gasPriceInWei = await web3.eth.getGasPrice()
    })

    beforeEach(async () => {
      contracts = await deploymentHelper.deployLiquityCore()
      contracts.troveManager = await TroveManagerTester.new()
      contracts.troveManagerHelpers = await TroveManagerHelpersTester.new()
      contracts.dchfToken = await DCHFTokenTester.new(contracts.stabilityPoolManager.address)
      const MONContracts = await deploymentHelper.deployMONContractsHardhat(accounts[0])

      priceFeed = contracts.priceFeedTestnet
      dchfToken = contracts.dchfToken
      sortedTroves = contracts.sortedTroves
      troveManager = contracts.troveManager
      troveManagerHelpers = contracts.troveManagerHelpers
      activePool = contracts.activePool
      defaultPool = contracts.defaultPool
      borrowerOperations = contracts.borrowerOperations
      hintHelpers = contracts.hintHelpers

      monToken = MONContracts.monToken
      communityIssuance = MONContracts.communityIssuance

      erc20 = contracts.erc20

      let index = 0
      for (const acc of accounts) {
        await erc20.mint(acc, await web3.eth.getBalance(acc))
        index++

        if (index >= 100) break
      }

      await deploymentHelper.connectCoreContracts(contracts, MONContracts)
      await deploymentHelper.connectMONContractsToCore(MONContracts, contracts)

      stabilityPool = await StabilityPool.at(
        await contracts.stabilityPoolManager.getAssetStabilityPool(ZERO_ADDRESS)
      )
      stabilityPoolERC20 = await StabilityPool.at(
        await contracts.stabilityPoolManager.getAssetStabilityPool(erc20.address)
      )
    })

    // --- provideToSP() ---
    // increases recorded DCHF at Stability Pool
    it('provideToSP(): increases the Stability Pool DCHF balance', async () => {
      // --- SETUP --- Give Alice a least 200
      await openTrove({
        extraDCHFAmount: toBN(200),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: alice },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(200),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: alice },
      })

      // --- TEST ---

      // provideToSP()
      await stabilityPool.provideToSP(200, { from: alice })
      await stabilityPoolERC20.provideToSP(200, { from: alice })

      // check DCHF balances after
      assert.equal(await stabilityPool.getTotalDCHFDeposits(), 200)
      assert.equal(await stabilityPoolERC20.getTotalDCHFDeposits(), 200)
    })

    it("provideToSP(): updates the user's deposit record in StabilityPool", async () => {
      // --- SETUP --- Give Alice a least 200
      await openTrove({
        extraDCHFAmount: toBN(200),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: alice },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(200),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: alice },
      })

      // --- TEST ---
      // check user's deposit record before
      assert.equal(await stabilityPool.deposits(alice), 0)
      assert.equal(await stabilityPoolERC20.deposits(alice), 0)

      // provideToSP()
      await stabilityPool.provideToSP(200, { from: alice })
      await stabilityPoolERC20.provideToSP(200, { from: alice })

      // check user's deposit record after
      assert.equal(await stabilityPool.deposits(alice), 200)
      assert.equal(await stabilityPoolERC20.deposits(alice), 200)
    })

    it("provideToSP(): reduces the user's DCHF balance by the correct amount", async () => {
      // --- SETUP --- Give Alice a least 200
      await openTrove({
        extraDCHFAmount: toBN(200),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: alice },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(200),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: alice },
      })

      // --- TEST ---
      // get user's deposit record before
      const alice_DCHFBalance_Before = await dchfToken.balanceOf(alice)

      // provideToSP()
      await stabilityPool.provideToSP(200, { from: alice })
      await stabilityPoolERC20.provideToSP(200, { from: alice })

      // check user's DCHF balance change
      const alice_DCHFBalance_After = await dchfToken.balanceOf(alice)
      assert.equal(alice_DCHFBalance_Before.sub(alice_DCHFBalance_After), '400')
    })

    it('provideToSP(): increases totalDCHFDeposits by correct amount', async () => {
      // --- SETUP ---

      // Whale opens Trove with 50 ETH, adds 2000 DCHF to StabilityPool
      await openTrove({
        extraDCHFAmount: toBN(dec(2000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: whale },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(2000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: whale },
      })
      await stabilityPool.provideToSP(dec(2000, 18), { from: whale })
      await stabilityPoolERC20.provideToSP(dec(2000, 18), { from: whale })

      assert.equal(await stabilityPool.getTotalDCHFDeposits(), dec(2000, 18))
      assert.equal(await stabilityPoolERC20.getTotalDCHFDeposits(), dec(2000, 18))
    })

    it('provideToSP(): Correctly updates user snapshots of accumulated rewards per unit staked', async () => {
      // --- SETUP ---

      // Whale opens Trove and deposits to SP
      await openTrove({
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: whale, value: dec(50, 'ether') },
      })
      await openTrove({
        asset: erc20.address,
        assetSent: dec(50, 'ether'),
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: whale },
      })
      const whaleDCHF = (await dchfToken.balanceOf(whale)).div(toBN(2))
      await stabilityPool.provideToSP(whaleDCHF, { from: whale })
      await stabilityPoolERC20.provideToSP(whaleDCHF, { from: whale })

      // 2 Troves opened, each withdraws minimum debt
      await openTrove({
        extraDCHFAmount: 0,
        ICR: toBN(dec(2, 18)),
        extraParams: { from: defaulter_1 },
      })
      await openTrove({
        extraDCHFAmount: 0,
        ICR: toBN(dec(2, 18)),
        extraParams: { from: defaulter_2 },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: 0,
        ICR: toBN(dec(2, 18)),
        extraParams: { from: defaulter_1 },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: 0,
        ICR: toBN(dec(2, 18)),
        extraParams: { from: defaulter_2 },
      })

      // Alice makes Trove and withdraws 100 DCHF
      await openTrove({
        extraDCHFAmount: toBN(dec(100, 18)),
        ICR: toBN(dec(5, 18)),
        extraParams: { from: alice, value: dec(50, 'ether') },
      })
      await openTrove({
        asset: erc20.address,
        assetSent: dec(50, 'ether'),
        extraDCHFAmount: toBN(dec(100, 18)),
        ICR: toBN(dec(5, 18)),
        extraParams: { from: alice },
      })

      // price drops: defaulter's Troves fall below MCR, whale doesn't
      await priceFeed.setPrice(dec(105, 18))

      const SPDCHF_Before = await stabilityPool.getTotalDCHFDeposits()
      const SPDCHF_BeforeERC20 = await stabilityPoolERC20.getTotalDCHFDeposits()

      // Troves are closed
      await troveManager.liquidate(ZERO_ADDRESS, defaulter_1, { from: owner })
      await troveManager.liquidate(ZERO_ADDRESS, defaulter_2, { from: owner })
      await troveManager.liquidate(erc20.address, defaulter_1, { from: owner })
      await troveManager.liquidate(erc20.address, defaulter_2, { from: owner })
      assert.isFalse(await sortedTroves.contains(ZERO_ADDRESS, defaulter_1))
      assert.isFalse(await sortedTroves.contains(ZERO_ADDRESS, defaulter_2))
      assert.isFalse(await sortedTroves.contains(erc20.address, defaulter_1))
      assert.isFalse(await sortedTroves.contains(erc20.address, defaulter_2))

      // Confirm SP has decreased
      const SPDCHF_After = await stabilityPool.getTotalDCHFDeposits()
      const SPDCHF_AfterERC20 = await stabilityPoolERC20.getTotalDCHFDeposits()
      assert.isTrue(SPDCHF_After.lt(SPDCHF_Before))
      assert.isTrue(SPDCHF_AfterERC20.lt(SPDCHF_BeforeERC20))

      // --- TEST ---
      const P_Before = await stabilityPool.P()
      const S_Before = await stabilityPool.epochToScaleToSum(0, 0)
      const G_Before = await stabilityPool.epochToScaleToG(0, 0)

      const P_BeforeERC20 = await stabilityPoolERC20.P()
      const S_BeforeERC20 = await stabilityPoolERC20.epochToScaleToSum(0, 0)
      const G_BeforeERC20 = await stabilityPoolERC20.epochToScaleToG(0, 0)

      assert.isTrue(P_Before.gt(toBN('0')))
      assert.isTrue(S_Before.gt(toBN('0')))
      assert.isTrue(P_BeforeERC20.gt(toBN('0')))
      assert.isTrue(S_BeforeERC20.gt(toBN('0')))

      // Check 'Before' snapshots
      const alice_snapshot_Before = await stabilityPool.depositSnapshots(alice)
      const alice_snapshot_S_Before = alice_snapshot_Before[0].toString()
      const alice_snapshot_P_Before = alice_snapshot_Before[1].toString()
      const alice_snapshot_G_Before = alice_snapshot_Before[2].toString()

      const alice_snapshot_BeforeERC20 = await stabilityPoolERC20.depositSnapshots(alice)
      const alice_snapshot_S_BeforeERC20 = alice_snapshot_BeforeERC20[0].toString()
      const alice_snapshot_P_BeforeERC20 = alice_snapshot_BeforeERC20[1].toString()
      const alice_snapshot_G_BeforeERC20 = alice_snapshot_BeforeERC20[2].toString()
      assert.equal(alice_snapshot_S_Before, '0')
      assert.equal(alice_snapshot_P_Before, '0')
      assert.equal(alice_snapshot_G_Before, '0')

      assert.equal(alice_snapshot_S_BeforeERC20, '0')
      assert.equal(alice_snapshot_P_BeforeERC20, '0')
      assert.equal(alice_snapshot_G_BeforeERC20, '0')

      // Make deposit
      await stabilityPool.provideToSP(dec(100, 18), { from: alice })
      await stabilityPoolERC20.provideToSP(dec(100, 18), { from: alice })

      // Check 'After' snapshots
      const alice_snapshot_After = await stabilityPool.depositSnapshots(alice)
      const alice_snapshot_S_After = alice_snapshot_After[0].toString()
      const alice_snapshot_P_After = alice_snapshot_After[1].toString()
      const alice_snapshot_G_After = alice_snapshot_After[2].toString()

      const alice_snapshot_AfterERC20 = await stabilityPoolERC20.depositSnapshots(alice)
      const alice_snapshot_S_AfterERC20 = alice_snapshot_AfterERC20[0].toString()
      const alice_snapshot_P_AfterERC20 = alice_snapshot_AfterERC20[1].toString()
      const alice_snapshot_G_AfterERC20 = alice_snapshot_AfterERC20[2].toString()

      assert.equal(alice_snapshot_S_After, S_Before)
      assert.equal(alice_snapshot_P_After, P_Before)
      assert.equal(alice_snapshot_G_After, G_Before)

      assert.equal(alice_snapshot_S_AfterERC20, S_BeforeERC20)
      assert.equal(alice_snapshot_P_AfterERC20, P_BeforeERC20)
      assert.equal(alice_snapshot_G_AfterERC20, G_BeforeERC20)
    })

    it("provideToSP(), multiple deposits: updates user's deposit and snapshots", async () => {
      // --- SETUP ---
      // Whale opens Trove and deposits to SP
      await openTrove({
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: whale, value: dec(50, 'ether') },
      })
      await openTrove({
        asset: erc20.address,
        assetSent: dec(50, 'ether'),
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: whale },
      })

      const whaleDCHF = (await dchfToken.balanceOf(whale)).div(toBN(2))
      await stabilityPool.provideToSP(whaleDCHF, { from: whale })
      await stabilityPoolERC20.provideToSP(whaleDCHF, { from: whale })

      // 3 Troves opened. Two users withdraw 160 DCHF each
      await openTrove({
        extraDCHFAmount: 0,
        ICR: toBN(dec(2, 18)),
        extraParams: { from: defaulter_1, value: dec(50, 'ether') },
      })
      await openTrove({
        extraDCHFAmount: 0,
        ICR: toBN(dec(2, 18)),
        extraParams: { from: defaulter_2, value: dec(50, 'ether') },
      })
      await openTrove({
        extraDCHFAmount: 0,
        ICR: toBN(dec(2, 18)),
        extraParams: { from: defaulter_3, value: dec(50, 'ether') },
      })

      await openTrove({
        asset: erc20.address,
        assetSent: dec(50, 'ether'),
        extraDCHFAmount: 0,
        ICR: toBN(dec(2, 18)),
        extraParams: { from: defaulter_1 },
      })
      await openTrove({
        asset: erc20.address,
        assetSent: dec(50, 'ether'),
        extraDCHFAmount: 0,
        ICR: toBN(dec(2, 18)),
        extraParams: { from: defaulter_2 },
      })
      await openTrove({
        asset: erc20.address,
        assetSent: dec(50, 'ether'),
        extraDCHFAmount: 0,
        ICR: toBN(dec(2, 18)),
        extraParams: { from: defaulter_3 },
      })

      // --- TEST ---

      // Alice makes deposit #1: 150 DCHF
      await openTrove({
        extraDCHFAmount: toBN(dec(250, 18)),
        ICR: toBN(dec(3, 18)),
        extraParams: { from: alice },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(250, 18)),
        ICR: toBN(dec(3, 18)),
        extraParams: { from: alice },
      })
      await stabilityPool.provideToSP(dec(150, 18), { from: alice })
      await stabilityPoolERC20.provideToSP(dec(150, 18), { from: alice })

      const alice_Snapshot_0 = await stabilityPool.depositSnapshots(alice)
      const alice_Snapshot_S_0 = alice_Snapshot_0[0]
      const alice_Snapshot_P_0 = alice_Snapshot_0[1]

      const alice_Snapshot_0ERC20 = await stabilityPoolERC20.depositSnapshots(alice)
      const alice_Snapshot_S_0ERC20 = alice_Snapshot_0ERC20[0]
      const alice_Snapshot_P_0ERC20 = alice_Snapshot_0ERC20[1]

      assert.equal(alice_Snapshot_S_0, 0)
      assert.equal(alice_Snapshot_P_0, '1000000000000000000')
      assert.equal(alice_Snapshot_S_0ERC20, 0)
      assert.equal(alice_Snapshot_P_0ERC20, '1000000000000000000')

      // price drops: defaulters' Troves fall below MCR, alice and whale Trove remain active
      await priceFeed.setPrice(dec(105, 18))

      // 2 users with Trove with 180 DCHF drawn are closed
      await troveManager.liquidate(ZERO_ADDRESS, defaulter_1, { from: owner })
      await troveManager.liquidate(ZERO_ADDRESS, defaulter_2, { from: owner })

      await troveManager.liquidate(erc20.address, defaulter_1, { from: owner })
      await troveManager.liquidate(erc20.address, defaulter_2, { from: owner })

      const alice_compoundedDeposit_1 = await stabilityPool.getCompoundedDCHFDeposit(alice)
      const alice_compoundedDeposit_1ERC20 = await stabilityPoolERC20.getCompoundedDCHFDeposit(alice)

      // Alice makes deposit #2
      const alice_topUp_1 = toBN(dec(100, 18))
      await stabilityPool.provideToSP(alice_topUp_1, { from: alice })
      await stabilityPoolERC20.provideToSP(alice_topUp_1, { from: alice })

      const alice_newDeposit_1 = (await stabilityPool.deposits(alice)).toString()
      assert.equal(alice_compoundedDeposit_1.add(alice_topUp_1), alice_newDeposit_1)

      const alice_newDeposit_1ERC20 = (await stabilityPoolERC20.deposits(alice)).toString()
      assert.equal(alice_compoundedDeposit_1ERC20.add(alice_topUp_1), alice_newDeposit_1ERC20)

      // get system reward terms
      const P_1 = await stabilityPool.P()
      const S_1 = await stabilityPool.epochToScaleToSum(0, 0)
      assert.isTrue(P_1.lt(toBN(dec(1, 18))))
      assert.isTrue(S_1.gt(toBN('0')))

      const P_1ERC20 = await stabilityPoolERC20.P()
      const S_1ERC20 = await stabilityPoolERC20.epochToScaleToSum(0, 0)
      assert.isTrue(P_1ERC20.lt(toBN(dec(1, 18))))
      assert.isTrue(S_1ERC20.gt(toBN('0')))

      // check Alice's new snapshot is correct
      const alice_Snapshot_1 = await stabilityPool.depositSnapshots(alice)
      const alice_Snapshot_S_1 = alice_Snapshot_1[0]
      const alice_Snapshot_P_1 = alice_Snapshot_1[1]
      assert.isTrue(alice_Snapshot_S_1.eq(S_1))
      assert.isTrue(alice_Snapshot_P_1.eq(P_1))

      const alice_Snapshot_1ERC20 = await stabilityPoolERC20.depositSnapshots(alice)
      const alice_Snapshot_S_1ERC20 = alice_Snapshot_1ERC20[0]
      const alice_Snapshot_P_1ERC20 = alice_Snapshot_1ERC20[1]
      assert.isTrue(alice_Snapshot_S_1ERC20.eq(S_1))
      assert.isTrue(alice_Snapshot_P_1ERC20.eq(P_1))

      // Bob withdraws DCHF and deposits to StabilityPool
      await openTrove({
        extraDCHFAmount: toBN(dec(1000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: bob },
      })
      await stabilityPool.provideToSP(dec(427, 18), { from: alice })

      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(1000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: bob },
      })
      await stabilityPoolERC20.provideToSP(dec(427, 18), { from: alice })

      // Defaulter 3 Trove is closed
      await troveManager.liquidate(ZERO_ADDRESS, defaulter_3, { from: owner })
      await troveManager.liquidate(erc20.address, defaulter_3, { from: owner })

      const alice_compoundedDeposit_2 = await stabilityPool.getCompoundedDCHFDeposit(alice)
      const alice_compoundedDeposit_2ERC20 = await stabilityPoolERC20.getCompoundedDCHFDeposit(alice)

      const P_2 = await stabilityPool.P()
      const S_2 = await stabilityPool.epochToScaleToSum(0, 0)
      assert.isTrue(P_2.lt(P_1))
      assert.isTrue(S_2.gt(S_1))

      const P_2ERC20 = await stabilityPoolERC20.P()
      const S_2ERC20 = await stabilityPoolERC20.epochToScaleToSum(0, 0)
      assert.isTrue(P_2ERC20.lt(P_1ERC20))
      assert.isTrue(S_2ERC20.gt(S_1ERC20))

      // Alice makes deposit #3:  100DCHF
      await stabilityPool.provideToSP(dec(100, 18), { from: alice })
      await stabilityPoolERC20.provideToSP(dec(100, 18), { from: alice })

      // check Alice's new snapshot is correct
      const alice_Snapshot_2 = await stabilityPool.depositSnapshots(alice)
      const alice_Snapshot_S_2 = alice_Snapshot_2[0]
      const alice_Snapshot_P_2 = alice_Snapshot_2[1]
      assert.isTrue(alice_Snapshot_S_2.eq(S_2))
      assert.isTrue(alice_Snapshot_P_2.eq(P_2))

      const alice_Snapshot_2ERC20 = await stabilityPoolERC20.depositSnapshots(alice)
      const alice_Snapshot_S_2ERC20 = alice_Snapshot_2ERC20[0]
      const alice_Snapshot_P_2ERC20 = alice_Snapshot_2ERC20[1]
      assert.isTrue(alice_Snapshot_S_2ERC20.eq(S_2ERC20))
      assert.isTrue(alice_Snapshot_P_2ERC20.eq(P_2ERC20))
    })

    it('provideToSP(): reverts if user tries to provide more than their DCHF balance', async () => {
      await openTrove({
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: whale, value: dec(50, 'ether') },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: alice, value: dec(50, 'ether') },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: bob, value: dec(50, 'ether') },
      })

      await openTrove({
        asset: erc20.address,
        assetSent: dec(50, 'ether'),
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: whale },
      })
      await openTrove({
        asset: erc20.address,
        assetSent: dec(50, 'ether'),
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: alice },
      })
      await openTrove({
        asset: erc20.address,
        assetSent: dec(50, 'ether'),
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: bob },
      })

      const aliceDCHFbal = await dchfToken.balanceOf(alice)
      const bobDCHFbal = await dchfToken.balanceOf(bob)

      // Alice, attempts to deposit 1 wei more than her balance

      const aliceTxPromise = stabilityPool.provideToSP(aliceDCHFbal.add(toBN(1)), {
        from: alice,
      })
      const aliceTxPromiseERC20 = stabilityPoolERC20.provideToSP(aliceDCHFbal.add(toBN(1)), {
        from: alice,
      })
      await assertRevert(aliceTxPromise, 'revert')
      await assertRevert(aliceTxPromiseERC20, 'revert')

      // Bob, attempts to deposit 235534 more than his balance

      const bobTxPromise = stabilityPool.provideToSP(bobDCHFbal.add(toBN(dec(235534, 18))), {
        from: bob,
      })
      const bobTxPromiseERC20 = stabilityPoolERC20.provideToSP(bobDCHFbal.add(toBN(dec(235534, 18))), {
        from: bob,
      })
      await assertRevert(bobTxPromise, 'revert')
      await assertRevert(bobTxPromiseERC20, 'revert')
    })

    it('provideToSP(): reverts if user tries to provide 2^256-1 DCHF, which exceeds their balance', async () => {
      await openTrove({
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: whale, value: dec(50, 'ether') },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: alice, value: dec(50, 'ether') },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: bob, value: dec(50, 'ether') },
      })

      await openTrove({
        asset: erc20.address,
        assetSent: dec(50, 'ether'),
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: whale },
      })
      await openTrove({
        asset: erc20.address,
        assetSent: dec(50, 'ether'),
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: alice },
      })
      await openTrove({
        asset: erc20.address,
        assetSent: dec(50, 'ether'),
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: bob },
      })

      const maxBytes32 = web3.utils.toBN('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')

      // Alice attempts to deposit 2^256-1 DCHF
      try {
        aliceTx = await stabilityPool.provideToSP(maxBytes32, { from: alice })
        assert.isFalse(tx.receipt.status)
      } catch (error) {
        assert.include(error.message, 'revert')
      }

      try {
        aliceTx = await stabilityPoolERC20.provideToSP(maxBytes32, { from: alice })
        assert.isFalse(tx.receipt.status)
      } catch (error) {
        assert.include(error.message, 'revert')
      }
    })

    it('provideToSP(): reverts if cannot receive ETH Gain', async () => {
      // --- SETUP ---
      // Whale deposits 1850 DCHF in StabilityPool
      await openTrove({
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: whale, value: dec(50, 'ether') },
      })
      await stabilityPool.provideToSP(dec(1850, 18), { from: whale })

      await openTrove({
        asset: erc20.address,
        assetSent: dec(50, 'ether'),
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: whale },
      })
      await stabilityPoolERC20.provideToSP(dec(1850, 18), { from: whale })

      // Defaulter Troves opened
      await openTrove({
        extraDCHFAmount: 0,
        ICR: toBN(dec(2, 18)),
        extraParams: { from: defaulter_1 },
      })
      await openTrove({
        extraDCHFAmount: 0,
        ICR: toBN(dec(2, 18)),
        extraParams: { from: defaulter_2 },
      })

      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: 0,
        ICR: toBN(dec(2, 18)),
        extraParams: { from: defaulter_1 },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: 0,
        ICR: toBN(dec(2, 18)),
        extraParams: { from: defaulter_2 },
      })

      // --- TEST ---

      const nonPayable = await NonPayable.new()
      await dchfToken.transfer(nonPayable.address, dec(250, 18), { from: whale })
      await dchfToken.transfer(nonPayable.address, dec(250, 18), { from: whale })

      // NonPayable makes deposit #1: 150 DCHF
      const txData1 = th.getTransactionData('provideToSP(uint256)', [web3.utils.toHex(dec(150, 18))])
      await nonPayable.forward(stabilityPool.address, txData1)
      await nonPayable.forward(stabilityPoolERC20.address, txData1)

      const gain_0 = await stabilityPool.getDepositorAssetGain(nonPayable.address)
      assert.isTrue(gain_0.eq(toBN(0)), 'NonPayable should not have accumulated gains')

      const gain_0ERC20 = await stabilityPoolERC20.getDepositorAssetGain(nonPayable.address)
      assert.isTrue(gain_0ERC20.eq(toBN(0)), 'NonPayable should not have accumulated gains')

      // price drops: defaulters' Troves fall below MCR, nonPayable and whale Trove remain active
      await priceFeed.setPrice(dec(105, 18))

      // 2 defaulters are closed
      await troveManager.liquidate(ZERO_ADDRESS, defaulter_1, { from: owner })
      await troveManager.liquidate(ZERO_ADDRESS, defaulter_2, { from: owner })

      await troveManager.liquidate(erc20.address, defaulter_1, { from: owner })
      await troveManager.liquidate(erc20.address, defaulter_2, { from: owner })

      const gain_1 = await stabilityPool.getDepositorAssetGain(nonPayable.address)
      assert.isTrue(gain_1.gt(toBN(0)), 'NonPayable should have some accumulated gains')

      const gain_1ERC20 = await stabilityPoolERC20.getDepositorAssetGain(nonPayable.address)
      assert.isTrue(gain_1ERC20.gt(toBN(0)), 'NonPayable should have some accumulated gains')

      // NonPayable tries to make deposit #2: 100DCHF (which also attempts to withdraw ETH gain)
      const txData2 = th.getTransactionData('provideToSP(uint256)', [web3.utils.toHex(dec(100, 18))])
      await th.assertRevert(
        nonPayable.forward(stabilityPool.address, txData2),
        'StabilityPool: sending ETH failed'
      )
    })

    it("provideToSP(): doesn't impact other users' deposits or ETH gains", async () => {
      await openTrove({
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: whale, value: dec(50, 'ether') },
      })
      await openTrove({
        asset: erc20.address,
        assetSent: dec(50, 'ether'),
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: whale },
      })

      // A, B, C open troves and make Stability Pool deposits
      await openTrove({
        extraDCHFAmount: toBN(dec(1000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: alice },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(2000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: bob },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(3000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: carol },
      })

      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(1000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: alice },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(2000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: bob },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(3000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: carol },
      })

      await stabilityPool.provideToSP(dec(1000, 18), { from: alice })
      await stabilityPool.provideToSP(dec(2000, 18), { from: bob })
      await stabilityPool.provideToSP(dec(3000, 18), { from: carol })

      await stabilityPoolERC20.provideToSP(dec(1000, 18), { from: alice })
      await stabilityPoolERC20.provideToSP(dec(2000, 18), { from: bob })
      await stabilityPoolERC20.provideToSP(dec(3000, 18), { from: carol })

      // D opens a trove
      await openTrove({
        extraDCHFAmount: toBN(dec(300, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: dennis },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(300, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: dennis },
      })

      // Would-be defaulters open troves
      await openTrove({
        extraDCHFAmount: 0,
        ICR: toBN(dec(2, 18)),
        extraParams: { from: defaulter_1 },
      })
      await openTrove({
        extraDCHFAmount: 0,
        ICR: toBN(dec(2, 18)),
        extraParams: { from: defaulter_2 },
      })

      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: 0,
        ICR: toBN(dec(2, 18)),
        extraParams: { from: defaulter_1 },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: 0,
        ICR: toBN(dec(2, 18)),
        extraParams: { from: defaulter_2 },
      })

      // Price drops
      await priceFeed.setPrice(dec(105, 18))

      // Defaulters are liquidated
      await troveManager.liquidate(ZERO_ADDRESS, defaulter_1)
      await troveManager.liquidate(ZERO_ADDRESS, defaulter_2)
      await troveManager.liquidate(erc20.address, defaulter_1)
      await troveManager.liquidate(erc20.address, defaulter_2)
      assert.isFalse(await sortedTroves.contains(ZERO_ADDRESS, defaulter_1))
      assert.isFalse(await sortedTroves.contains(ZERO_ADDRESS, defaulter_2))
      assert.isFalse(await sortedTroves.contains(erc20.address, defaulter_1))
      assert.isFalse(await sortedTroves.contains(erc20.address, defaulter_2))

      const alice_DCHFDeposit_Before = (await stabilityPool.getCompoundedDCHFDeposit(alice)).toString()
      const bob_DCHFDeposit_Before = (await stabilityPool.getCompoundedDCHFDeposit(bob)).toString()
      const carol_DCHFDeposit_Before = (await stabilityPool.getCompoundedDCHFDeposit(carol)).toString()

      const alice_DCHFDeposit_BeforeERC20 = (
        await stabilityPoolERC20.getCompoundedDCHFDeposit(alice)
      ).toString()
      const bob_DCHFDeposit_BeforeERC20 = (await stabilityPoolERC20.getCompoundedDCHFDeposit(bob)).toString()
      const carol_DCHFDeposit_BeforeERC20 = (
        await stabilityPoolERC20.getCompoundedDCHFDeposit(carol)
      ).toString()

      const alice_ETHGain_Before = (await stabilityPool.getDepositorAssetGain(alice)).toString()
      const bob_ETHGain_Before = (await stabilityPool.getDepositorAssetGain(bob)).toString()
      const carol_ETHGain_Before = (await stabilityPool.getDepositorAssetGain(carol)).toString()

      const alice_ETHGain_BeforeERC20 = (await stabilityPoolERC20.getDepositorAssetGain(alice)).toString()
      const bob_ETHGain_BeforeERC20 = (await stabilityPoolERC20.getDepositorAssetGain(bob)).toString()
      const carol_ETHGain_BeforeERC20 = (await stabilityPoolERC20.getDepositorAssetGain(carol)).toString()

      //check non-zero DCHF and AssetGain in the Stability Pool
      const DCHFinSP = await stabilityPool.getTotalDCHFDeposits()
      const ETHinSP = await stabilityPool.getAssetBalance()
      const DCHFinSPERC20 = await stabilityPoolERC20.getTotalDCHFDeposits()
      const ETHinSPERC20 = await stabilityPoolERC20.getAssetBalance()
      assert.isTrue(DCHFinSP.gt(mv._zeroBN))
      assert.isTrue(ETHinSP.gt(mv._zeroBN))
      assert.isTrue(DCHFinSPERC20.gt(mv._zeroBN))
      assert.isTrue(ETHinSPERC20.gt(mv._zeroBN))

      // D makes an SP deposit
      await stabilityPool.provideToSP(dec(1000, 18), { from: dennis })
      assert.equal((await stabilityPool.getCompoundedDCHFDeposit(dennis)).toString(), dec(1000, 18))

      await stabilityPoolERC20.provideToSP(dec(1000, 18), { from: dennis })
      assert.equal((await stabilityPoolERC20.getCompoundedDCHFDeposit(dennis)).toString(), dec(1000, 18))

      const alice_DCHFDeposit_After = (await stabilityPool.getCompoundedDCHFDeposit(alice)).toString()
      const bob_DCHFDeposit_After = (await stabilityPool.getCompoundedDCHFDeposit(bob)).toString()
      const carol_DCHFDeposit_After = (await stabilityPool.getCompoundedDCHFDeposit(carol)).toString()

      const alice_DCHFDeposit_AfterERC20 = (
        await stabilityPoolERC20.getCompoundedDCHFDeposit(alice)
      ).toString()
      const bob_DCHFDeposit_AfterERC20 = (await stabilityPoolERC20.getCompoundedDCHFDeposit(bob)).toString()
      const carol_DCHFDeposit_AfterERC20 = (
        await stabilityPoolERC20.getCompoundedDCHFDeposit(carol)
      ).toString()

      const alice_ETHGain_After = (await stabilityPool.getDepositorAssetGain(alice)).toString()
      const bob_ETHGain_After = (await stabilityPool.getDepositorAssetGain(bob)).toString()
      const carol_ETHGain_After = (await stabilityPool.getDepositorAssetGain(carol)).toString()

      const alice_ETHGain_AfterERC20 = (await stabilityPoolERC20.getDepositorAssetGain(alice)).toString()
      const bob_ETHGain_AfterERC20 = (await stabilityPoolERC20.getDepositorAssetGain(bob)).toString()
      const carol_ETHGain_AfterERC20 = (await stabilityPoolERC20.getDepositorAssetGain(carol)).toString()

      // Check compounded deposits and ETH gains for A, B and C have not changed
      assert.equal(alice_DCHFDeposit_Before, alice_DCHFDeposit_After)
      assert.equal(bob_DCHFDeposit_Before, bob_DCHFDeposit_After)
      assert.equal(carol_DCHFDeposit_Before, carol_DCHFDeposit_After)

      assert.equal(alice_DCHFDeposit_BeforeERC20, alice_DCHFDeposit_AfterERC20)
      assert.equal(bob_DCHFDeposit_BeforeERC20, bob_DCHFDeposit_AfterERC20)
      assert.equal(carol_DCHFDeposit_BeforeERC20, carol_DCHFDeposit_AfterERC20)

      assert.equal(alice_ETHGain_Before, alice_ETHGain_After)
      assert.equal(bob_ETHGain_Before, bob_ETHGain_After)
      assert.equal(carol_ETHGain_Before, carol_ETHGain_After)

      assert.equal(alice_ETHGain_BeforeERC20, alice_ETHGain_AfterERC20)
      assert.equal(bob_ETHGain_BeforeERC20, bob_ETHGain_AfterERC20)
      assert.equal(carol_ETHGain_BeforeERC20, carol_ETHGain_AfterERC20)
    })

    it("provideToSP(): doesn't impact system debt, collateral or TCR", async () => {
      await openTrove({
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: whale, value: dec(50, 'ether') },
      })
      await openTrove({
        asset: erc20.address,
        assetSent: dec(50, 'ether'),
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: whale },
      })

      // A, B, C open troves and make Stability Pool deposits
      await openTrove({
        extraDCHFAmount: toBN(dec(1000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: alice },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(2000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: bob },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(3000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: carol },
      })

      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(1000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: alice },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(2000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: bob },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(3000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: carol },
      })

      await stabilityPool.provideToSP(dec(1000, 18), { from: alice })
      await stabilityPool.provideToSP(dec(2000, 18), { from: bob })
      await stabilityPool.provideToSP(dec(3000, 18), { from: carol })

      await stabilityPoolERC20.provideToSP(dec(1000, 18), { from: alice })
      await stabilityPoolERC20.provideToSP(dec(2000, 18), { from: bob })
      await stabilityPoolERC20.provideToSP(dec(3000, 18), { from: carol })

      // D opens a trove
      await openTrove({
        extraDCHFAmount: toBN(dec(3000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: dennis },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(3000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: dennis },
      })

      // Would-be defaulters open troves
      await openTrove({
        extraDCHFAmount: 0,
        ICR: toBN(dec(2, 18)),
        extraParams: { from: defaulter_1 },
      })
      await openTrove({
        extraDCHFAmount: 0,
        ICR: toBN(dec(2, 18)),
        extraParams: { from: defaulter_2 },
      })

      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: 0,
        ICR: toBN(dec(2, 18)),
        extraParams: { from: defaulter_1 },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: 0,
        ICR: toBN(dec(2, 18)),
        extraParams: { from: defaulter_2 },
      })

      // Price drops
      await priceFeed.setPrice(dec(105, 18))

      // Defaulters are liquidated
      await troveManager.liquidate(ZERO_ADDRESS, defaulter_1)
      await troveManager.liquidate(ZERO_ADDRESS, defaulter_2)
      await troveManager.liquidate(erc20.address, defaulter_1)
      await troveManager.liquidate(erc20.address, defaulter_2)
      assert.isFalse(await sortedTroves.contains(ZERO_ADDRESS, defaulter_1))
      assert.isFalse(await sortedTroves.contains(ZERO_ADDRESS, defaulter_2))
      assert.isFalse(await sortedTroves.contains(erc20.address, defaulter_1))
      assert.isFalse(await sortedTroves.contains(erc20.address, defaulter_2))

      const activeDebt_Before = (await activePool.getDCHFDebt(ZERO_ADDRESS)).toString()
      const defaultedDebt_Before = (await defaultPool.getDCHFDebt(ZERO_ADDRESS)).toString()
      const activeColl_Before = (await activePool.getAssetBalance(ZERO_ADDRESS)).toString()
      const defaultedColl_Before = (await defaultPool.getAssetBalance(ZERO_ADDRESS)).toString()
      const TCR_Before = (await th.getTCR(contracts)).toString()

      const activeDebt_BeforeERC20 = (await activePool.getDCHFDebt(erc20.address)).toString()
      const defaultedDebt_BeforeERC20 = (await defaultPool.getDCHFDebt(erc20.address)).toString()
      const activeColl_BeforeERC20 = (await activePool.getAssetBalance(erc20.address)).toString()
      const defaultedColl_BeforeERC20 = (await defaultPool.getAssetBalance(erc20.address)).toString()
      const TCR_BeforeERC20 = (await th.getTCR(contracts, erc20.address)).toString()

      // D makes an SP deposit
      await stabilityPool.provideToSP(dec(1000, 18), { from: dennis })
      assert.equal((await stabilityPool.getCompoundedDCHFDeposit(dennis)).toString(), dec(1000, 18))

      await stabilityPoolERC20.provideToSP(dec(1000, 18), { from: dennis })
      assert.equal((await stabilityPoolERC20.getCompoundedDCHFDeposit(dennis)).toString(), dec(1000, 18))

      const activeDebt_After = (await activePool.getDCHFDebt(ZERO_ADDRESS)).toString()
      const defaultedDebt_After = (await defaultPool.getDCHFDebt(ZERO_ADDRESS)).toString()
      const activeColl_After = (await activePool.getAssetBalance(ZERO_ADDRESS)).toString()
      const defaultedColl_After = (await defaultPool.getAssetBalance(ZERO_ADDRESS)).toString()
      const TCR_After = (await th.getTCR(contracts)).toString()

      const activeDebt_AfterERC20 = (await activePool.getDCHFDebt(erc20.address)).toString()
      const defaultedDebt_AfterERC20 = (await defaultPool.getDCHFDebt(erc20.address)).toString()
      const activeColl_AfterERC20 = (await activePool.getAssetBalance(erc20.address)).toString()
      const defaultedColl_AfterERC20 = (await defaultPool.getAssetBalance(erc20.address)).toString()
      const TCR_AfterERC20 = (await th.getTCR(contracts, erc20.address)).toString()

      // Check total system debt, collateral and TCR have not changed after a Stability deposit is made
      assert.equal(activeDebt_Before, activeDebt_After)
      assert.equal(defaultedDebt_Before, defaultedDebt_After)
      assert.equal(activeColl_Before, activeColl_After)
      assert.equal(defaultedColl_Before, defaultedColl_After)
      assert.equal(TCR_Before, TCR_After)

      assert.equal(activeDebt_BeforeERC20, activeDebt_AfterERC20)
      assert.equal(defaultedDebt_BeforeERC20, defaultedDebt_AfterERC20)
      assert.equal(activeColl_BeforeERC20, activeColl_AfterERC20)
      assert.equal(defaultedColl_BeforeERC20, defaultedColl_AfterERC20)
      assert.equal(TCR_BeforeERC20, TCR_AfterERC20)
    })

    it("provideToSP(): doesn't impact any troves, including the caller's trove", async () => {
      await openTrove({
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: whale, value: dec(50, 'ether') },
      })
      await openTrove({
        asset: erc20.address,
        assetSent: dec(50, 'ether'),
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: whale },
      })

      // A, B, C open troves and make Stability Pool deposits
      await openTrove({
        extraDCHFAmount: toBN(dec(1000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: alice },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(2000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: bob },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(3000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: carol },
      })

      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(1000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: alice },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(2000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: bob },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(3000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: carol },
      })

      // A and B provide to SP
      await stabilityPool.provideToSP(dec(1000, 18), { from: alice })
      await stabilityPool.provideToSP(dec(2000, 18), { from: bob })

      await stabilityPoolERC20.provideToSP(dec(1000, 18), { from: alice })
      await stabilityPoolERC20.provideToSP(dec(2000, 18), { from: bob })

      // D opens a trove
      await openTrove({
        extraDCHFAmount: toBN(dec(1000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: dennis },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(1000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: dennis },
      })

      // Price drops
      await priceFeed.setPrice(dec(105, 18))
      const price = await priceFeed.getPrice()

      // Get debt, collateral and ICR of all existing troves
      const whale_Debt_Before = (await troveManagerHelpers.Troves(whale, ZERO_ADDRESS))[0].toString()
      const alice_Debt_Before = (await troveManagerHelpers.Troves(alice, ZERO_ADDRESS))[0].toString()
      const bob_Debt_Before = (await troveManagerHelpers.Troves(bob, ZERO_ADDRESS))[0].toString()
      const carol_Debt_Before = (await troveManagerHelpers.Troves(carol, ZERO_ADDRESS))[0].toString()
      const dennis_Debt_Before = (await troveManagerHelpers.Troves(dennis, ZERO_ADDRESS))[0].toString()

      const whale_Debt_BeforeERC20 = (await troveManagerHelpers.Troves(whale, erc20.address))[0].toString()
      const alice_Debt_BeforeERC20 = (await troveManagerHelpers.Troves(alice, erc20.address))[0].toString()
      const bob_Debt_BeforeERC20 = (await troveManagerHelpers.Troves(bob, erc20.address))[0].toString()
      const carol_Debt_BeforeERC20 = (await troveManagerHelpers.Troves(carol, erc20.address))[0].toString()
      const dennis_Debt_BeforeERC20 = (await troveManagerHelpers.Troves(dennis, erc20.address))[0].toString()

      const whale_Coll_Before = (await troveManagerHelpers.Troves(whale, ZERO_ADDRESS))[
        th.TROVE_COLL_INDEX
      ].toString()
      const alice_Coll_Before = (await troveManagerHelpers.Troves(alice, ZERO_ADDRESS))[
        th.TROVE_COLL_INDEX
      ].toString()
      const bob_Coll_Before = (await troveManagerHelpers.Troves(bob, ZERO_ADDRESS))[
        th.TROVE_COLL_INDEX
      ].toString()
      const carol_Coll_Before = (await troveManagerHelpers.Troves(carol, ZERO_ADDRESS))[
        th.TROVE_COLL_INDEX
      ].toString()
      const dennis_Coll_Before = (await troveManagerHelpers.Troves(dennis, ZERO_ADDRESS))[
        th.TROVE_COLL_INDEX
      ].toString()

      const whale_Coll_BeforeERC20 = (await troveManagerHelpers.Troves(whale, erc20.address))[
        th.TROVE_COLL_INDEX
      ].toString()
      const alice_Coll_BeforeERC20 = (await troveManagerHelpers.Troves(alice, erc20.address))[
        th.TROVE_COLL_INDEX
      ].toString()
      const bob_Coll_BeforeERC20 = (await troveManagerHelpers.Troves(bob, erc20.address))[
        th.TROVE_COLL_INDEX
      ].toString()
      const carol_Coll_BeforeERC20 = (await troveManagerHelpers.Troves(carol, erc20.address))[
        th.TROVE_COLL_INDEX
      ].toString()
      const dennis_Coll_BeforeERC20 = (await troveManagerHelpers.Troves(dennis, erc20.address))[
        th.TROVE_COLL_INDEX
      ].toString()

      const whale_ICR_Before = (
        await troveManagerHelpers.getCurrentICR(ZERO_ADDRESS, whale, price)
      ).toString()
      const alice_ICR_Before = (
        await troveManagerHelpers.getCurrentICR(ZERO_ADDRESS, alice, price)
      ).toString()
      const bob_ICR_Before = (await troveManagerHelpers.getCurrentICR(ZERO_ADDRESS, bob, price)).toString()
      const carol_ICR_Before = (
        await troveManagerHelpers.getCurrentICR(ZERO_ADDRESS, carol, price)
      ).toString()
      const dennis_ICR_Before = (
        await troveManagerHelpers.getCurrentICR(ZERO_ADDRESS, dennis, price)
      ).toString()

      const whale_ICR_BeforeERC20 = (
        await troveManagerHelpers.getCurrentICR(erc20.address, whale, price)
      ).toString()
      const alice_ICR_BeforeERC20 = (
        await troveManagerHelpers.getCurrentICR(erc20.address, alice, price)
      ).toString()
      const bob_ICR_BeforeERC20 = (
        await troveManagerHelpers.getCurrentICR(erc20.address, bob, price)
      ).toString()
      const carol_ICR_BeforeERC20 = (
        await troveManagerHelpers.getCurrentICR(erc20.address, carol, price)
      ).toString()
      const dennis_ICR_BeforeERC20 = (
        await troveManagerHelpers.getCurrentICR(erc20.address, dennis, price)
      ).toString()

      // D makes an SP deposit
      await stabilityPool.provideToSP(dec(1000, 18), { from: dennis })
      assert.equal((await stabilityPool.getCompoundedDCHFDeposit(dennis)).toString(), dec(1000, 18))

      await stabilityPoolERC20.provideToSP(dec(1000, 18), { from: dennis })
      assert.equal((await stabilityPoolERC20.getCompoundedDCHFDeposit(dennis)).toString(), dec(1000, 18))

      const whale_Debt_After = (await troveManagerHelpers.Troves(whale, ZERO_ADDRESS))[0].toString()
      const alice_Debt_After = (await troveManagerHelpers.Troves(alice, ZERO_ADDRESS))[0].toString()
      const bob_Debt_After = (await troveManagerHelpers.Troves(bob, ZERO_ADDRESS))[0].toString()
      const carol_Debt_After = (await troveManagerHelpers.Troves(carol, ZERO_ADDRESS))[0].toString()
      const dennis_Debt_After = (await troveManagerHelpers.Troves(dennis, ZERO_ADDRESS))[0].toString()

      const whale_Coll_After = (await troveManagerHelpers.Troves(whale, ZERO_ADDRESS))[
        th.TROVE_COLL_INDEX
      ].toString()
      const alice_Coll_After = (await troveManagerHelpers.Troves(alice, ZERO_ADDRESS))[
        th.TROVE_COLL_INDEX
      ].toString()
      const bob_Coll_After = (await troveManagerHelpers.Troves(bob, ZERO_ADDRESS))[
        th.TROVE_COLL_INDEX
      ].toString()
      const carol_Coll_After = (await troveManagerHelpers.Troves(carol, ZERO_ADDRESS))[
        th.TROVE_COLL_INDEX
      ].toString()
      const dennis_Coll_After = (await troveManagerHelpers.Troves(dennis, ZERO_ADDRESS))[
        th.TROVE_COLL_INDEX
      ].toString()

      const whale_ICR_After = (await troveManagerHelpers.getCurrentICR(ZERO_ADDRESS, whale, price)).toString()
      const alice_ICR_After = (await troveManagerHelpers.getCurrentICR(ZERO_ADDRESS, alice, price)).toString()
      const bob_ICR_After = (await troveManagerHelpers.getCurrentICR(ZERO_ADDRESS, bob, price)).toString()
      const carol_ICR_After = (await troveManagerHelpers.getCurrentICR(ZERO_ADDRESS, carol, price)).toString()
      const dennis_ICR_After = (
        await troveManagerHelpers.getCurrentICR(ZERO_ADDRESS, dennis, price)
      ).toString()

      const whale_Debt_AfterERC20 = (await troveManagerHelpers.Troves(whale, erc20.address))[0].toString()
      const alice_Debt_AfterERC20 = (await troveManagerHelpers.Troves(alice, erc20.address))[0].toString()
      const bob_Debt_AfterERC20 = (await troveManagerHelpers.Troves(bob, erc20.address))[0].toString()
      const carol_Debt_AfterERC20 = (await troveManagerHelpers.Troves(carol, erc20.address))[0].toString()
      const dennis_Debt_AfterERC20 = (await troveManagerHelpers.Troves(dennis, erc20.address))[0].toString()

      const whale_Coll_AfterERC20 = (await troveManagerHelpers.Troves(whale, erc20.address))[
        th.TROVE_COLL_INDEX
      ].toString()
      const alice_Coll_AfterERC20 = (await troveManagerHelpers.Troves(alice, erc20.address))[
        th.TROVE_COLL_INDEX
      ].toString()
      const bob_Coll_AfterERC20 = (await troveManagerHelpers.Troves(bob, erc20.address))[
        th.TROVE_COLL_INDEX
      ].toString()
      const carol_Coll_AfterERC20 = (await troveManagerHelpers.Troves(carol, erc20.address))[
        th.TROVE_COLL_INDEX
      ].toString()
      const dennis_Coll_AfterERC20 = (await troveManagerHelpers.Troves(dennis, erc20.address))[
        th.TROVE_COLL_INDEX
      ].toString()

      const whale_ICR_AfterERC20 = (
        await troveManagerHelpers.getCurrentICR(erc20.address, whale, price)
      ).toString()
      const alice_ICR_AfterERC20 = (
        await troveManagerHelpers.getCurrentICR(erc20.address, alice, price)
      ).toString()
      const bob_ICR_AfterERC20 = (
        await troveManagerHelpers.getCurrentICR(erc20.address, bob, price)
      ).toString()
      const carol_ICR_AfterERC20 = (
        await troveManagerHelpers.getCurrentICR(erc20.address, carol, price)
      ).toString()
      const dennis_ICR_AfterERC20 = (
        await troveManagerHelpers.getCurrentICR(erc20.address, dennis, price)
      ).toString()

      assert.equal(whale_Debt_Before, whale_Debt_After)
      assert.equal(alice_Debt_Before, alice_Debt_After)
      assert.equal(bob_Debt_Before, bob_Debt_After)
      assert.equal(carol_Debt_Before, carol_Debt_After)
      assert.equal(dennis_Debt_Before, dennis_Debt_After)

      assert.equal(whale_Coll_Before, whale_Coll_After)
      assert.equal(alice_Coll_Before, alice_Coll_After)
      assert.equal(bob_Coll_Before, bob_Coll_After)
      assert.equal(carol_Coll_Before, carol_Coll_After)
      assert.equal(dennis_Coll_Before, dennis_Coll_After)

      assert.equal(whale_ICR_Before, whale_ICR_After)
      assert.equal(alice_ICR_Before, alice_ICR_After)
      assert.equal(bob_ICR_Before, bob_ICR_After)
      assert.equal(carol_ICR_Before, carol_ICR_After)
      assert.equal(dennis_ICR_Before, dennis_ICR_After)

      assert.equal(whale_Debt_BeforeERC20, whale_Debt_AfterERC20)
      assert.equal(alice_Debt_BeforeERC20, alice_Debt_AfterERC20)
      assert.equal(bob_Debt_BeforeERC20, bob_Debt_AfterERC20)
      assert.equal(carol_Debt_BeforeERC20, carol_Debt_AfterERC20)
      assert.equal(dennis_Debt_BeforeERC20, dennis_Debt_AfterERC20)

      assert.equal(whale_Coll_BeforeERC20, whale_Coll_AfterERC20)
      assert.equal(alice_Coll_BeforeERC20, alice_Coll_AfterERC20)
      assert.equal(bob_Coll_BeforeERC20, bob_Coll_AfterERC20)
      assert.equal(carol_Coll_BeforeERC20, carol_Coll_AfterERC20)
      assert.equal(dennis_Coll_BeforeERC20, dennis_Coll_AfterERC20)

      assert.equal(whale_ICR_BeforeERC20, whale_ICR_AfterERC20)
      assert.equal(alice_ICR_BeforeERC20, alice_ICR_AfterERC20)
      assert.equal(bob_ICR_BeforeERC20, bob_ICR_AfterERC20)
      assert.equal(carol_ICR_BeforeERC20, carol_ICR_AfterERC20)
      assert.equal(dennis_ICR_BeforeERC20, dennis_ICR_AfterERC20)
    })

    it("provideToSP(): doesn't protect the depositor's trove from liquidation", async () => {
      await openTrove({
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: whale, value: dec(50, 'ether') },
      })
      await openTrove({
        asset: erc20.address,
        assetSent: dec(50, 'ether'),
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: whale },
      })

      // A, B, C open troves and make Stability Pool deposits
      await openTrove({
        extraDCHFAmount: toBN(dec(1000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: alice },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(2000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: bob },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(3000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: carol },
      })

      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(1000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: alice },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(2000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: bob },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(3000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: carol },
      })

      // A, B provide 100 DCHF to SP
      await stabilityPool.provideToSP(dec(1000, 18), { from: alice })
      await stabilityPool.provideToSP(dec(1000, 18), { from: bob })

      await stabilityPoolERC20.provideToSP(dec(1000, 18), { from: alice })
      await stabilityPoolERC20.provideToSP(dec(1000, 18), { from: bob })

      // Confirm Bob has an active trove in the system
      assert.isTrue(await sortedTroves.contains(ZERO_ADDRESS, bob))
      assert.equal((await troveManagerHelpers.getTroveStatus(ZERO_ADDRESS, bob)).toString(), '1')

      assert.isTrue(await sortedTroves.contains(erc20.address, bob))
      assert.equal((await troveManagerHelpers.getTroveStatus(erc20.address, bob)).toString(), '1')

      // Confirm Bob has a Stability deposit
      assert.equal((await stabilityPool.getCompoundedDCHFDeposit(bob)).toString(), dec(1000, 18))
      assert.equal((await stabilityPoolERC20.getCompoundedDCHFDeposit(bob)).toString(), dec(1000, 18))

      // Price drops
      await priceFeed.setPrice(dec(105, 18))
      const price = await priceFeed.getPrice()

      // Liquidate bob
      await troveManager.liquidate(ZERO_ADDRESS, bob)
      await troveManager.liquidate(erc20.address, bob)

      // Check Bob's trove has been removed from the system
      assert.isFalse(await sortedTroves.contains(ZERO_ADDRESS, bob))
      assert.equal((await troveManagerHelpers.getTroveStatus(ZERO_ADDRESS, bob)).toString(), '3')

      assert.isFalse(await sortedTroves.contains(erc20.address, bob))
      assert.equal((await troveManagerHelpers.getTroveStatus(erc20.address, bob)).toString(), '3')
    })

    it('provideToSP(): providing 0 DCHF reverts', async () => {
      // --- SETUP ---
      await openTrove({
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: whale, value: dec(50, 'ether') },
      })
      await openTrove({
        asset: erc20.address,
        assetSent: dec(50, 'ether'),
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: whale },
      })

      // A, B, C open troves and make Stability Pool deposits
      await openTrove({
        extraDCHFAmount: toBN(dec(1000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: alice },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(2000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: bob },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(3000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: carol },
      })

      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(1000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: alice },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(2000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: bob },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(3000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: carol },
      })

      // A, B, C provides 100, 50, 30 DCHF to SP
      await stabilityPool.provideToSP(dec(100, 18), { from: alice })
      await stabilityPool.provideToSP(dec(50, 18), { from: bob })
      await stabilityPool.provideToSP(dec(30, 18), { from: carol })

      await stabilityPoolERC20.provideToSP(dec(100, 18), { from: alice })
      await stabilityPoolERC20.provideToSP(dec(50, 18), { from: bob })
      await stabilityPoolERC20.provideToSP(dec(30, 18), { from: carol })

      const bob_Deposit_Before = (await stabilityPool.getCompoundedDCHFDeposit(bob)).toString()
      const DCHFinSP_Before = (await stabilityPool.getTotalDCHFDeposits()).toString()

      const bob_Deposit_BeforeERC20 = (await stabilityPoolERC20.getCompoundedDCHFDeposit(bob)).toString()
      const DCHFinSP_BeforeERC20 = (await stabilityPoolERC20.getTotalDCHFDeposits()).toString()

      assert.equal(DCHFinSP_Before, dec(180, 18))
      assert.equal(DCHFinSP_BeforeERC20, dec(180, 18))

      // Bob provides 0 DCHF to the Stability Pool
      const txPromise_B = stabilityPool.provideToSP(0, { from: bob })
      await th.assertRevert(txPromise_B)

      const txPromise_BERC20 = stabilityPoolERC20.provideToSP(0, { from: bob })
      await th.assertRevert(txPromise_BERC20)
    })

    // --- MON functionality ---
    it('provideToSP(), new deposit: when SP > 0, triggers MON reward event - increases the sum G', async () => {
      await openTrove({
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: whale, value: dec(50, 'ether') },
      })
      await openTrove({
        asset: erc20.address,
        assetSent: dec(50, 'ether'),
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: whale },
      })

      // A, B, C open troves and make Stability Pool deposits
      await openTrove({
        extraDCHFAmount: toBN(dec(1000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: A },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(2000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: B },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(3000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: C },
      })

      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(1000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: A },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(2000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: B },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(3000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: C },
      })

      // A provides to SP
      await stabilityPool.provideToSP(dec(1000, 18), { from: A })
      await stabilityPoolERC20.provideToSP(dec(1000, 18), { from: A })

      let currentEpoch = await stabilityPool.currentEpoch()
      let currentScale = await stabilityPool.currentScale()
      const G_Before = await stabilityPool.epochToScaleToG(currentEpoch, currentScale)

      let currentEpochERC20 = await stabilityPoolERC20.currentEpoch()
      let currentScaleERC20 = await stabilityPoolERC20.currentScale()
      const G_BeforeERC20 = await stabilityPoolERC20.epochToScaleToG(currentEpochERC20, currentScaleERC20)

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

      // B provides to SP
      await stabilityPool.provideToSP(dec(1000, 18), { from: B })
      await stabilityPoolERC20.provideToSP(dec(1000, 18), { from: B })

      currentEpoch = await stabilityPool.currentEpoch()
      currentScale = await stabilityPool.currentScale()
      const G_After = await stabilityPool.epochToScaleToG(currentEpoch, currentScale)

      currentEpochERC20 = await stabilityPoolERC20.currentEpoch()
      currentScaleERC20 = await stabilityPoolERC20.currentScale()
      const G_AfterERC20 = await stabilityPoolERC20.epochToScaleToG(currentEpochERC20, currentScaleERC20)

      // Expect G has increased from the MON reward event triggered
      assert.isTrue(G_After.gt(G_Before))
      assert.isTrue(G_AfterERC20.gt(G_BeforeERC20))
    })

    it("provideToSP(), new deposit: when SP is empty, doesn't update G", async () => {
      await openTrove({
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: whale, value: dec(50, 'ether') },
      })
      await openTrove({
        asset: erc20.address,
        assetSent: dec(50, 'ether'),
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: whale },
      })

      // A, B, C open troves and make Stability Pool deposits
      await openTrove({
        extraDCHFAmount: toBN(dec(1000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: A },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(2000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: B },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(3000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: C },
      })

      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(1000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: A },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(2000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: B },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(3000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: C },
      })

      // A provides to SP
      await stabilityPool.provideToSP(dec(1000, 18), { from: A })
      await stabilityPoolERC20.provideToSP(dec(1000, 18), { from: A })

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

      // A withdraws
      await stabilityPool.withdrawFromSP(dec(1000, 18), { from: A })
      await stabilityPoolERC20.withdrawFromSP(dec(1000, 18), { from: A })

      // Check SP is empty
      assert.equal(await stabilityPool.getTotalDCHFDeposits(), '0')
      assert.equal(await stabilityPoolERC20.getTotalDCHFDeposits(), '0')

      // Check G is non-zero
      let currentEpoch = await stabilityPool.currentEpoch()
      let currentScale = await stabilityPool.currentScale()
      const G_Before = await stabilityPool.epochToScaleToG(currentEpoch, currentScale)

      let currentEpochERC20 = await stabilityPoolERC20.currentEpoch()
      let currentScaleERC20 = await stabilityPoolERC20.currentScale()
      const G_BeforeERC20 = await stabilityPoolERC20.epochToScaleToG(currentEpochERC20, currentScaleERC20)

      assert.isTrue(G_Before.gt(toBN('0')))
      assert.isTrue(G_BeforeERC20.gt(toBN('0')))

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

      // B provides to SP
      await stabilityPool.provideToSP(dec(1000, 18), { from: B })
      await stabilityPoolERC20.provideToSP(dec(1000, 18), { from: B })

      currentEpoch = await stabilityPool.currentEpoch()
      currentScale = await stabilityPool.currentScale()
      const G_After = await stabilityPool.epochToScaleToG(currentEpoch, currentScale)

      currentEpochERC20 = await stabilityPoolERC20.currentEpoch()
      currentScaleERC20 = await stabilityPoolERC20.currentScale()
      const G_AfterERC20 = await stabilityPoolERC20.epochToScaleToG(currentEpochERC20, currentScaleERC20)

      // Expect G has not changed
      assert.isTrue(G_After.eq(G_Before))
      assert.isTrue(G_AfterERC20.eq(G_BeforeERC20))
    })

    it('provideToSP(), new deposit: sets the correct front end tag', async () => {
      await openTrove({
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: whale, value: dec(50, 'ether') },
      })
      await openTrove({
        asset: erc20.address,
        assetSent: dec(50, 'ether'),
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: whale },
      })

      // A, B, C, D open troves and make Stability Pool deposits
      await openTrove({
        extraDCHFAmount: toBN(dec(1000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: A },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(2000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: B },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(3000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: C },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(3000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: D },
      })

      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(1000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: A },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(2000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: B },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(3000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: C },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(3000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: D },
      })

      // A, B, C, D provides to SP
      await stabilityPool.provideToSP(dec(1000, 18), { from: A })
      await stabilityPool.provideToSP(dec(2000, 18), { from: B })
      await stabilityPool.provideToSP(dec(3000, 18), { from: C })
      await stabilityPool.provideToSP(dec(4000, 18), { from: D })

      await stabilityPoolERC20.provideToSP(dec(1000, 18), { from: A })
      await stabilityPoolERC20.provideToSP(dec(2000, 18), { from: B })
      await stabilityPoolERC20.provideToSP(dec(3000, 18), { from: C })
      await stabilityPoolERC20.provideToSP(dec(4000, 18), { from: D })
    })

    it('provideToSP(), new deposit: depositor does not receive any MON rewards', async () => {
      await openTrove({
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: whale, value: dec(50, 'ether') },
      })
      await openTrove({
        asset: erc20.address,
        assetSent: dec(50, 'ether'),
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: whale },
      })

      // A, B, open troves
      await openTrove({
        extraDCHFAmount: toBN(dec(1000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: A },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(2000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: B },
      })

      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(1000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: A },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(2000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: B },
      })

      // Get A, B, C MON balances before and confirm they're zero
      const A_MONBalance_Before = await monToken.balanceOf(A)
      const B_MONBalance_Before = await monToken.balanceOf(B)

      assert.equal(A_MONBalance_Before, '0')
      assert.equal(B_MONBalance_Before, '0')

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

      // A, B provide to SP
      await stabilityPool.provideToSP(dec(1000, 18), { from: A })
      await stabilityPool.provideToSP(dec(2000, 18), { from: B })

      await stabilityPoolERC20.provideToSP(dec(1000, 18), { from: A })
      await stabilityPoolERC20.provideToSP(dec(2000, 18), { from: B })

      // Get A, B, C MON balances after, and confirm they're still zero
      const A_MONBalance_After = await monToken.balanceOf(A)
      const B_MONBalance_After = await monToken.balanceOf(B)

      assert.equal(A_MONBalance_After, '0')
      assert.equal(B_MONBalance_After, '0')
    })

    it('provideToSP(), new deposit after past full withdrawal: depositor does not receive any MON rewards', async () => {
      await openTrove({
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(10, 18)),
        extraParams: { from: whale },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(10, 18)),
        extraParams: { from: whale },
      })

      // A, B, C, open troves
      await openTrove({
        extraDCHFAmount: toBN(dec(1000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: A },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(2000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: B },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(3000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: C },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(4000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: D },
      })

      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(1000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: A },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(2000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: B },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(3000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: C },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(4000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: D },
      })

      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })
      await openTrove({
        asset: erc20.address,
        ICR: toBN(dec(2, 18)),
        extraParams: { from: defaulter_1 },
      })

      // --- SETUP ---

      const initialDeposit_A = (await dchfToken.balanceOf(A)).div(toBN(2))
      const initialDeposit_B = (await dchfToken.balanceOf(B)).div(toBN(2))
      // A, B provide to SP
      await stabilityPool.provideToSP(initialDeposit_A, { from: A })
      await stabilityPool.provideToSP(initialDeposit_B, { from: B })

      await stabilityPoolERC20.provideToSP(initialDeposit_A, { from: A })
      await stabilityPoolERC20.provideToSP(initialDeposit_B, { from: B })

      // time passes
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

      // C deposits. A, and B earn MON
      await stabilityPool.provideToSP(dec(5, 18), { from: C })
      await stabilityPoolERC20.provideToSP(dec(5, 18), { from: C })

      // Price drops, defaulter is liquidated, A, B and C earn ETH
      await priceFeed.setPrice(dec(105, 18))
      assert.isFalse(await th.checkRecoveryMode(contracts))
      assert.isFalse(await th.checkRecoveryMode(contracts, erc20.address))

      await troveManager.liquidate(ZERO_ADDRESS, defaulter_1)
      await troveManager.liquidate(erc20.address, defaulter_1)

      // price bounces back to 200
      await priceFeed.setPrice(dec(200, 18))

      // A and B fully withdraw from the pool
      await stabilityPool.withdrawFromSP(initialDeposit_A, { from: A })
      await stabilityPool.withdrawFromSP(initialDeposit_B, { from: B })

      await stabilityPoolERC20.withdrawFromSP(initialDeposit_A, { from: A })
      await stabilityPoolERC20.withdrawFromSP(initialDeposit_B, { from: B })

      // --- TEST ---

      // Get A, B, C MON balances before and confirm they're non-zero
      const A_MONBalance_Before = await monToken.balanceOf(A)
      const B_MONBalance_Before = await monToken.balanceOf(B)
      assert.isTrue(A_MONBalance_Before.gt(toBN('0')))
      assert.isTrue(B_MONBalance_Before.gt(toBN('0')))

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

      // A, B provide to SP
      await stabilityPool.provideToSP(dec(100, 18), { from: A })
      await stabilityPool.provideToSP(dec(200, 18), { from: B })

      await stabilityPoolERC20.provideToSP(dec(100, 18), { from: A })
      await stabilityPoolERC20.provideToSP(dec(200, 18), { from: B })

      // Get A, B, C MON balances after, and confirm they have not changed
      const A_MONBalance_After = await monToken.balanceOf(A)
      const B_MONBalance_After = await monToken.balanceOf(B)

      assert.isTrue(A_MONBalance_After.eq(A_MONBalance_Before))
      assert.isTrue(B_MONBalance_After.eq(B_MONBalance_Before))
    })

    it("provideToSP(), new eligible deposit: tagged System's stake increases", async () => {
      await openTrove({
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(10, 18)),
        extraParams: { from: whale },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(10, 18)),
        extraParams: { from: whale },
      })

      // A, B, C, open troves
      await openTrove({
        extraDCHFAmount: toBN(dec(1000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: A },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(2000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: B },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(3000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: C },
      })

      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(1000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: A },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(2000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: B },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(3000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: C },
      })

      // Get front ends' stakes before
      const stake_Before = await stabilityPool.totalStakes()
      const stake_BeforeERC20 = await stabilityPoolERC20.totalStakes()

      const deposit_A = toBN(dec(1000, 18))
      const deposit_B = toBN(dec(2000, 18))
      const deposit_C = toBN(dec(3000, 18))

      // A, B, C provide to SP
      await stabilityPool.provideToSP(deposit_A, { from: A })
      await stabilityPool.provideToSP(deposit_B, { from: B })
      await stabilityPool.provideToSP(deposit_C, { from: C })

      await stabilityPoolERC20.provideToSP(deposit_A, { from: A })
      await stabilityPoolERC20.provideToSP(deposit_B, { from: B })
      await stabilityPoolERC20.provideToSP(deposit_C, { from: C })

      const stake_After = await stabilityPool.totalStakes()
      const stake_AfterERC20 = await stabilityPoolERC20.totalStakes()

      const Stake_Diff = stake_After.sub(stake_Before)
      const Stake_DiffERC20 = stake_AfterERC20.sub(stake_BeforeERC20)

      // Check front ends' stakes have increased by amount equal to the deposit made through them
      assert.equal(Stake_Diff.toString(), deposit_A.add(deposit_B).add(deposit_C).toString())
      assert.equal(Stake_DiffERC20.toString(), deposit_A.add(deposit_B).add(deposit_C).toString())
    })

    it("provideToSP(), new eligible deposit: tagged System's snapshots update", async () => {
      await openTrove({
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(10, 18)),
        extraParams: { from: whale },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(10, 18)),
        extraParams: { from: whale },
      })

      // A, B, C, open troves
      await openTrove({
        extraDCHFAmount: toBN(dec(1000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: A },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(2000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: B },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(3000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: C },
      })

      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(1000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: A },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(2000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: B },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(3000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: C },
      })

      // D opens trove
      await openTrove({
        extraDCHFAmount: toBN(dec(4000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: D },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(4000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: D },
      })

      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })
      await openTrove({
        asset: erc20.address,
        ICR: toBN(dec(2, 18)),
        extraParams: { from: defaulter_1 },
      })

      // --- SETUP ---

      await stabilityPool.provideToSP(dec(2000, 18), { from: D })
      await stabilityPoolERC20.provideToSP(dec(2000, 18), { from: D })

      // fastforward time then  make an SP deposit, to make G > 0
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)
      await stabilityPool.provideToSP(dec(2000, 18), { from: D })
      await stabilityPoolERC20.provideToSP(dec(2000, 18), { from: D })

      // Perform a liquidation to make 0 < P < 1, and S > 0
      await priceFeed.setPrice(dec(105, 18))
      assert.isFalse(await th.checkRecoveryMode(contracts))
      assert.isFalse(await th.checkRecoveryMode(contracts, erc20.address))

      await troveManager.liquidate(ZERO_ADDRESS, defaulter_1)
      await troveManager.liquidate(erc20.address, defaulter_1)

      const currentEpoch = await stabilityPool.currentEpoch()
      const currentScale = await stabilityPool.currentScale()

      const S_Before = await stabilityPool.epochToScaleToSum(currentEpoch, currentScale)
      const P_Before = await stabilityPool.P()
      const G_Before = await stabilityPool.epochToScaleToG(currentEpoch, currentScale)

      const currentEpochERC20 = await stabilityPoolERC20.currentEpoch()
      const currentScaleERC20 = await stabilityPoolERC20.currentScale()

      const S_BeforeERC20 = await stabilityPoolERC20.epochToScaleToSum(currentEpochERC20, currentScaleERC20)
      const P_BeforeERC20 = await stabilityPoolERC20.P()
      const G_BeforeERC20 = await stabilityPoolERC20.epochToScaleToG(currentEpochERC20, currentScaleERC20)

      // Confirm 0 < P < 1
      assert.isTrue(P_Before.gt(toBN('0')) && P_Before.lt(toBN(dec(1, 18))))
      assert.isTrue(P_BeforeERC20.gt(toBN('0')) && P_BeforeERC20.lt(toBN(dec(1, 18))))
      // Confirm S, G are both > 0
      assert.isTrue(S_Before.gt(toBN('0')))
      assert.isTrue(G_Before.gt(toBN('0')))
      assert.isTrue(S_BeforeERC20.gt(toBN('0')))
      assert.isTrue(G_BeforeERC20.gt(toBN('0')))

      const deposit_A = dec(1000, 18)
      const deposit_B = dec(2000, 18)

      // --- TEST ---

      // A, B, C provide to SP
      const G1 = await stabilityPool.epochToScaleToG(currentScale, currentEpoch)
      await stabilityPool.provideToSP(deposit_A, { from: A })

      const G2 = await stabilityPoolERC20.epochToScaleToG(currentScale, currentEpoch)
      await stabilityPoolERC20.provideToSP(deposit_B, { from: B })

      const snapshotAfter = await stabilityPool.systemSnapshots()

      // Check snapshots are the expected values
      assert.equal(snapshotAfter[0], '0') // S (should always be 0 for front ends)
      assert.isTrue(snapshotAfter[1].eq(P_Before)) // P
      assert.isTrue(snapshotAfter[2].eq(G1)) // G
      assert.equal(snapshotAfter[3], '0') // scale
      assert.equal(snapshotAfter[4], '0') // epoch

      const snapshotAfterERC20 = await stabilityPool.systemSnapshots()

      // Check snapshots are the expected values
      assert.equal(snapshotAfterERC20[0], '0') // S (should always be 0 for front ends)
      assert.isTrue(snapshotAfterERC20[1].eq(P_BeforeERC20)) // P
      assert.isTrue(snapshotAfterERC20[2].eq(G2)) // G
      assert.equal(snapshotAfterERC20[3], '0') // scale
      assert.equal(snapshotAfterERC20[4], '0') // epoch
    })

    it('provideToSP(), new deposit: depositor does not receive ETH gains', async () => {
      await openTrove({
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(10, 18)),
        extraParams: { from: whale },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(10, 18)),
        extraParams: { from: whale },
      })

      // Whale transfers DCHF to A, B
      await dchfToken.transfer(A, dec(200, 18), { from: whale })
      await dchfToken.transfer(B, dec(400, 18), { from: whale })

      // C, D open troves
      await openTrove({
        extraDCHFAmount: toBN(dec(1000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: C },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(2000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: D },
      })

      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(1000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: C },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(2000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: D },
      })

      // --- TEST ---

      // get current ETH balances
      const A_ETHBalance_Before = await web3.eth.getBalance(A)
      const B_ETHBalance_Before = await web3.eth.getBalance(B)
      const C_ETHBalance_Before = await web3.eth.getBalance(C)
      const D_ETHBalance_Before = await web3.eth.getBalance(D)

      const A_ETHBalance_BeforeERC20 = await erc20.balanceOf(A)
      const B_ETHBalance_BeforeERC20 = await erc20.balanceOf(B)
      const C_ETHBalance_BeforeERC20 = await erc20.balanceOf(C)
      const D_ETHBalance_BeforeERC20 = await erc20.balanceOf(D)

      // A, B, C, D provide to SP
      await stabilityPool.provideToSP(dec(100, 18), { from: A, gasPrice: 0 })
      await stabilityPool.provideToSP(dec(200, 18), { from: B, gasPrice: 0 })
      await stabilityPool.provideToSP(dec(300, 18), { from: C, gasPrice: 0 })
      await stabilityPool.provideToSP(dec(400, 18), { from: D, gasPrice: 0 })

      await stabilityPoolERC20.provideToSP(dec(100, 18), { from: A, gasPrice: 0 })
      await stabilityPoolERC20.provideToSP(dec(200, 18), { from: B, gasPrice: 0 })
      await stabilityPoolERC20.provideToSP(dec(300, 18), { from: C, gasPrice: 0 })
      await stabilityPoolERC20.provideToSP(dec(400, 18), { from: D, gasPrice: 0 })

      // Get  ETH balances after
      const A_ETHBalance_After = await web3.eth.getBalance(A)
      const B_ETHBalance_After = await web3.eth.getBalance(B)
      const C_ETHBalance_After = await web3.eth.getBalance(C)
      const D_ETHBalance_After = await web3.eth.getBalance(D)

      const A_ETHBalance_AfterERC20 = await erc20.balanceOf(A)
      const B_ETHBalance_AfterERC20 = await erc20.balanceOf(B)
      const C_ETHBalance_AfterERC20 = await erc20.balanceOf(C)
      const D_ETHBalance_AfterERC20 = await erc20.balanceOf(D)

      // Check ETH balances have not changed
      assert.equal(A_ETHBalance_After, A_ETHBalance_Before)
      assert.equal(B_ETHBalance_After, B_ETHBalance_Before)
      assert.equal(C_ETHBalance_After, C_ETHBalance_Before)
      assert.equal(D_ETHBalance_After, D_ETHBalance_Before)

      assert.equal(A_ETHBalance_AfterERC20, A_ETHBalance_BeforeERC20.toString())
      assert.equal(B_ETHBalance_AfterERC20, B_ETHBalance_BeforeERC20.toString())
      assert.equal(C_ETHBalance_AfterERC20, C_ETHBalance_BeforeERC20.toString())
      assert.equal(D_ETHBalance_AfterERC20, D_ETHBalance_BeforeERC20.toString())
    })

    it('provideToSP(), new deposit after past full withdrawal: depositor does not receive ETH gains', async () => {
      await openTrove({
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(10, 18)),
        extraParams: { from: whale },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(10, 18)),
        extraParams: { from: whale },
      })

      // Whale transfers DCHF to A, B
      await dchfToken.transfer(A, dec(2000, 18), { from: whale })
      await dchfToken.transfer(B, dec(2000, 18), { from: whale })

      // C, D open troves
      await openTrove({
        extraDCHFAmount: toBN(dec(4000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: C },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(5000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: D },
      })
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })

      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(4000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: C },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(5000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: D },
      })
      await openTrove({
        asset: erc20.address,
        ICR: toBN(dec(2, 18)),
        extraParams: { from: defaulter_1 },
      })

      // --- SETUP ---
      // A, B, C, D provide to SP
      await stabilityPool.provideToSP(dec(105, 18), { from: A })
      await stabilityPool.provideToSP(dec(105, 18), { from: B })
      await stabilityPool.provideToSP(dec(105, 18), { from: C })
      await stabilityPool.provideToSP(dec(105, 18), { from: D })

      await stabilityPoolERC20.provideToSP(dec(105, 18), { from: A })
      await stabilityPoolERC20.provideToSP(dec(105, 18), { from: B })
      await stabilityPoolERC20.provideToSP(dec(105, 18), { from: C })
      await stabilityPoolERC20.provideToSP(dec(105, 18), { from: D })

      // time passes
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

      // B deposits. A,B,C,D earn MON
      await stabilityPool.provideToSP(dec(5, 18), { from: B })
      await stabilityPoolERC20.provideToSP(dec(5, 18), { from: B })

      // Price drops, defaulter is liquidated, A, B, C, D earn ETH
      await priceFeed.setPrice(dec(105, 18))
      assert.isFalse(await th.checkRecoveryMode(contracts))
      assert.isFalse(await th.checkRecoveryMode(contracts, erc20.address))

      await troveManager.liquidate(ZERO_ADDRESS, defaulter_1)
      await troveManager.liquidate(erc20.address, defaulter_1)

      // Price bounces back
      await priceFeed.setPrice(dec(200, 18))

      // A B,C, D fully withdraw from the pool
      await stabilityPool.withdrawFromSP(dec(105, 18), { from: A })
      await stabilityPool.withdrawFromSP(dec(105, 18), { from: B })
      await stabilityPool.withdrawFromSP(dec(105, 18), { from: C })
      await stabilityPool.withdrawFromSP(dec(105, 18), { from: D })

      await stabilityPoolERC20.withdrawFromSP(dec(105, 18), { from: A })
      await stabilityPoolERC20.withdrawFromSP(dec(105, 18), { from: B })
      await stabilityPoolERC20.withdrawFromSP(dec(105, 18), { from: C })
      await stabilityPoolERC20.withdrawFromSP(dec(105, 18), { from: D })

      // --- TEST ---

      // get current ETH balances
      const A_ETHBalance_Before = await web3.eth.getBalance(A)
      const B_ETHBalance_Before = await web3.eth.getBalance(B)
      const C_ETHBalance_Before = await web3.eth.getBalance(C)
      const D_ETHBalance_Before = await web3.eth.getBalance(D)

      const A_ETHBalance_BeforeERC20 = await erc20.balanceOf(A)
      const B_ETHBalance_BeforeERC20 = await erc20.balanceOf(B)
      const C_ETHBalance_BeforeERC20 = await erc20.balanceOf(C)
      const D_ETHBalance_BeforeERC20 = await erc20.balanceOf(D)

      // A, B, C, D provide to SP
      await stabilityPool.provideToSP(dec(100, 18), { from: A, gasPrice: 0 })
      await stabilityPool.provideToSP(dec(200, 18), { from: B, gasPrice: 0 })
      await stabilityPool.provideToSP(dec(300, 18), { from: C, gasPrice: 0 })
      await stabilityPool.provideToSP(dec(400, 18), { from: D, gasPrice: 0 })

      await stabilityPoolERC20.provideToSP(dec(100, 18), { from: A, gasPrice: 0 })
      await stabilityPoolERC20.provideToSP(dec(200, 18), { from: B, gasPrice: 0 })
      await stabilityPoolERC20.provideToSP(dec(300, 18), { from: C, gasPrice: 0 })
      await stabilityPoolERC20.provideToSP(dec(400, 18), { from: D, gasPrice: 0 })

      // Get  ETH balances after
      const A_ETHBalance_After = await web3.eth.getBalance(A)
      const B_ETHBalance_After = await web3.eth.getBalance(B)
      const C_ETHBalance_After = await web3.eth.getBalance(C)
      const D_ETHBalance_After = await web3.eth.getBalance(D)

      const A_ETHBalance_AfterERC20 = await erc20.balanceOf(A)
      const B_ETHBalance_AfterERC20 = await erc20.balanceOf(B)
      const C_ETHBalance_AfterERC20 = await erc20.balanceOf(C)
      const D_ETHBalance_AfterERC20 = await erc20.balanceOf(D)

      // Check ETH balances have not changed
      assert.equal(A_ETHBalance_After, A_ETHBalance_Before)
      assert.equal(B_ETHBalance_After, B_ETHBalance_Before)
      assert.equal(C_ETHBalance_After, C_ETHBalance_Before)
      assert.equal(D_ETHBalance_After, D_ETHBalance_Before)

      assert.equal(A_ETHBalance_AfterERC20.toString(), A_ETHBalance_BeforeERC20.toString())
      assert.equal(B_ETHBalance_AfterERC20.toString(), B_ETHBalance_BeforeERC20.toString())
      assert.equal(C_ETHBalance_AfterERC20.toString(), C_ETHBalance_BeforeERC20.toString())
      assert.equal(D_ETHBalance_AfterERC20.toString(), D_ETHBalance_BeforeERC20.toString())
    })

    it('provideToSP(), topup: triggers MON reward event - increases the sum G', async () => {
      await openTrove({
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(10, 18)),
        extraParams: { from: whale },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(10, 18)),
        extraParams: { from: whale },
      })

      // A, B, C open troves
      await openTrove({
        extraDCHFAmount: toBN(dec(1000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: A },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(2000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: B },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(3000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: C },
      })

      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(1000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: A },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(2000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: B },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(3000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: C },
      })

      // A, B, C provide to SP
      await stabilityPool.provideToSP(dec(100, 18), { from: A })
      await stabilityPool.provideToSP(dec(50, 18), { from: B })
      await stabilityPool.provideToSP(dec(50, 18), { from: C })

      await stabilityPoolERC20.provideToSP(dec(100, 18), { from: A })
      await stabilityPoolERC20.provideToSP(dec(50, 18), { from: B })
      await stabilityPoolERC20.provideToSP(dec(50, 18), { from: C })

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

      const G_Before = await stabilityPool.epochToScaleToG(0, 0)
      const G_BeforeERC20 = await stabilityPoolERC20.epochToScaleToG(0, 0)

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

      // B tops up
      await stabilityPool.provideToSP(dec(100, 18), { from: B })
      await stabilityPoolERC20.provideToSP(dec(100, 18), { from: B })

      const G_After = await stabilityPool.epochToScaleToG(0, 0)
      const G_AfterERC20 = await stabilityPoolERC20.epochToScaleToG(0, 0)

      // Expect G has increased from the MON reward event triggered by B's topup
      assert.isTrue(G_After.gt(G_Before))
      assert.isTrue(G_AfterERC20.gt(G_BeforeERC20))
    })

    it('provideToSP(), topup: depositor receives MON rewards', async () => {
      await openTrove({
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(10, 18)),
        extraParams: { from: whale },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(10, 18)),
        extraParams: { from: whale },
      })

      // A, B, C open troves
      await openTrove({
        extraDCHFAmount: toBN(dec(100, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: A },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(200, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: B },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(300, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: C },
      })

      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(100, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: A },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(200, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: B },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(300, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: C },
      })

      // A, B, C, provide to SP
      await stabilityPool.provideToSP(dec(10, 18), { from: A })
      await stabilityPool.provideToSP(dec(20, 18), { from: B })
      await stabilityPool.provideToSP(dec(30, 18), { from: C })

      await stabilityPoolERC20.provideToSP(dec(10, 18), { from: A })
      await stabilityPoolERC20.provideToSP(dec(20, 18), { from: B })
      await stabilityPoolERC20.provideToSP(dec(30, 18), { from: C })

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

      // Get A, B, C MON balance before
      const A_MONBalance_Before = await monToken.balanceOf(A)
      const B_MONBalance_Before = await monToken.balanceOf(B)
      const C_MONBalance_Before = await monToken.balanceOf(C)

      // A, B, C top up
      await stabilityPool.provideToSP(dec(10, 18), { from: A })
      await stabilityPool.provideToSP(dec(20, 18), { from: B })
      await stabilityPool.provideToSP(dec(30, 18), { from: C })

      await stabilityPoolERC20.provideToSP(dec(10, 18), { from: A })
      await stabilityPoolERC20.provideToSP(dec(20, 18), { from: B })
      await stabilityPoolERC20.provideToSP(dec(30, 18), { from: C })

      // Get MON balance after
      const A_MONBalance_After = await monToken.balanceOf(A)
      const B_MONBalance_After = await monToken.balanceOf(B)
      const C_MONBalance_After = await monToken.balanceOf(C)

      // Check MON Balance of A, B, C has increased
      assert.isTrue(A_MONBalance_After.gt(A_MONBalance_Before))
      assert.isTrue(B_MONBalance_After.gt(B_MONBalance_Before))
      assert.isTrue(C_MONBalance_After.gt(C_MONBalance_Before))
    })

    it("provideToSP(), topup: system's stake increases", async () => {
      await openTrove({
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(10, 18)),
        extraParams: { from: whale },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(10, 18)),
        extraParams: { from: whale },
      })

      await openTrove({
        extraDCHFAmount: toBN(dec(100, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: A },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(100, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: A },
      })

      await stabilityPool.provideToSP(dec(10, 18), { from: A })

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

      const F1_Stake_Before = await stabilityPool.totalStakes()

      await stabilityPool.provideToSP(dec(10, 18), { from: A })

      const F1_Stake_After = await stabilityPool.totalStakes()

      assert.isTrue(F1_Stake_After.gt(F1_Stake_Before))
    })

    it("provideToSP(), topup: System's snapshots update", async () => {
      await openTrove({
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(10, 18)),
        extraParams: { from: whale },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(10, 18)),
        extraParams: { from: whale },
      })

      // A, B, C, open troves
      await openTrove({
        extraDCHFAmount: toBN(dec(200, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: A },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(400, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: B },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(600, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: C },
      })

      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(200, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: A },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(400, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: B },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(600, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: C },
      })

      // D opens trove
      await openTrove({
        extraDCHFAmount: toBN(dec(1000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: D },
      })
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })

      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(1000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: D },
      })
      await openTrove({
        asset: erc20.address,
        ICR: toBN(dec(2, 18)),
        extraParams: { from: defaulter_1 },
      })

      // --- SETUP ---

      const deposit_A = dec(100, 18)
      const deposit_B = dec(200, 18)
      const deposit_C = dec(300, 18)

      // A, B, C make their initial deposits
      await stabilityPool.provideToSP(deposit_A, { from: A })
      await stabilityPool.provideToSP(deposit_B, { from: B })
      await stabilityPool.provideToSP(deposit_C, { from: C })

      await stabilityPoolERC20.provideToSP(deposit_A, { from: A })
      await stabilityPoolERC20.provideToSP(deposit_B, { from: B })
      await stabilityPoolERC20.provideToSP(deposit_C, { from: C })

      // fastforward time then make an SP deposit, to make G > 0
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

      const dchfD_Balance = toBN(await dchfToken.balanceOf(D)).div(toBN(2))
      await stabilityPool.provideToSP(dchfD_Balance, { from: D })
      await stabilityPoolERC20.provideToSP(dchfD_Balance, { from: D })

      // perform a liquidation to make 0 < P < 1, and S > 0
      await priceFeed.setPrice(dec(100, 18))
      assert.isFalse(await th.checkRecoveryMode(contracts))
      assert.isFalse(await th.checkRecoveryMode(contracts, erc20.address))

      await troveManager.liquidate(ZERO_ADDRESS, defaulter_1)
      await troveManager.liquidate(erc20.address, defaulter_1)

      const currentEpoch = await stabilityPool.currentEpoch()
      const currentScale = await stabilityPool.currentScale()

      const currentEpochERC20 = await stabilityPoolERC20.currentEpoch()
      const currentScaleERC20 = await stabilityPoolERC20.currentScale()

      const S_Before = await stabilityPool.epochToScaleToSum(currentEpoch, currentScale)
      const P_Before = await stabilityPool.P()
      const G_Before = await stabilityPool.epochToScaleToG(currentEpoch, currentScale)

      const S_BeforeERC20 = await stabilityPoolERC20.epochToScaleToSum(currentEpochERC20, currentScaleERC20)
      const P_BeforeERC20 = await stabilityPoolERC20.P()
      const G_BeforeERC20 = await stabilityPoolERC20.epochToScaleToG(currentEpochERC20, currentScaleERC20)

      // Confirm 0 < P < 1
      assert.isTrue(P_Before.gt(toBN('0')) && P_Before.lt(toBN(dec(1, 18))))
      assert.isTrue(P_BeforeERC20.gt(toBN('0')) && P_BeforeERC20.lt(toBN(dec(1, 18))))
      // Confirm S, G are both > 0
      assert.isTrue(S_Before.gt(toBN('0')))
      assert.isTrue(G_Before.gt(toBN('0')))
      assert.isTrue(S_BeforeERC20.gt(toBN('0')))
      assert.isTrue(G_BeforeERC20.gt(toBN('0')))

      // --- TEST ---

      // A, B, C top up their deposits. Grab G at each stage, as it can increase a bit
      // between topups, because some block.timestamp time passes (and LQTY is issued) between ops
      const G1 = await stabilityPool.epochToScaleToG(currentScale, currentEpoch)
      await stabilityPool.provideToSP(deposit_A, { from: A })

      const G1ERC20 = await stabilityPoolERC20.epochToScaleToG(currentScaleERC20, currentEpochERC20)
      await stabilityPoolERC20.provideToSP(deposit_A, { from: A })

      const snapshot = await stabilityPool.systemSnapshots()
      assert.equal(snapshot[0], '0') // S (should always be 0 for front ends)
      assert.isTrue(snapshot[1].eq(P_Before)) // P
      assert.isTrue(snapshot[2].eq(G1)) // G
      assert.equal(snapshot[3], '0') // scale
      assert.equal(snapshot[4], '0') // epoch

      const snapshotERC20 = await stabilityPoolERC20.systemSnapshots()
      assert.equal(snapshotERC20[0], '0') // S (should always be 0 for front ends)
      assert.isTrue(snapshotERC20[1].eq(P_BeforeERC20)) // P
      assert.isTrue(snapshotERC20[2].eq(G1ERC20)) // G
      assert.equal(snapshotERC20[3], '0') // scale
      assert.equal(snapshotERC20[4], '0') // epoch
    })

    it('provideToSP(): reverts when amount is zero', async () => {
      await openTrove({
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(10, 18)),
        extraParams: { from: whale },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(10, 18)),
        extraParams: { from: whale },
      })

      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(1000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: A },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(2000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: B },
      })

      // Whale transfers DCHF to C, D
      await dchfToken.transfer(C, dec(200, 18), { from: whale })
      await dchfToken.transfer(D, dec(200, 18), { from: whale })

      txPromise_A = stabilityPool.provideToSP(0, { from: A })
      txPromise_B = stabilityPool.provideToSP(0, { from: B })
      txPromise_C = stabilityPool.provideToSP(0, { from: C })
      txPromise_D = stabilityPool.provideToSP(0, { from: D })

      txPromise_AERC20 = stabilityPoolERC20.provideToSP(0, { from: A })
      txPromise_BERC20 = stabilityPoolERC20.provideToSP(0, { from: B })
      txPromise_CERC20 = stabilityPoolERC20.provideToSP(0, { from: C })
      txPromise_DERC20 = stabilityPoolERC20.provideToSP(0, { from: D })

      await th.assertRevert(txPromise_A, 'StabilityPool: Amount must be non-zero')
      await th.assertRevert(txPromise_B, 'StabilityPool: Amount must be non-zero')
      await th.assertRevert(txPromise_C, 'StabilityPool: Amount must be non-zero')
      await th.assertRevert(txPromise_D, 'StabilityPool: Amount must be non-zero')

      await th.assertRevert(txPromise_AERC20, 'StabilityPool: Amount must be non-zero')
      await th.assertRevert(txPromise_BERC20, 'StabilityPool: Amount must be non-zero')
      await th.assertRevert(txPromise_CERC20, 'StabilityPool: Amount must be non-zero')
      await th.assertRevert(txPromise_DERC20, 'StabilityPool: Amount must be non-zero')
    })
  })
})

// contract("Reset chain state", async (accounts) => {})

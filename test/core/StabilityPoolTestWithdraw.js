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

    // --- withdrawFromSP ---

    it('withdrawFromSP(): reverts when user has no active deposit', async () => {
      await openTrove({
        extraDCHFAmount: toBN(dec(100, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: alice },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(100, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: bob },
      })

      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(100, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: alice },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(100, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: bob },
      })

      await stabilityPool.provideToSP(dec(100, 18), { from: alice })
      await stabilityPoolERC20.provideToSP(dec(100, 18), { from: alice })

      const alice_initialDeposit = (await stabilityPool.deposits(alice)).toString()
      const bob_initialDeposit = (await stabilityPool.deposits(bob)).toString()

      const alice_initialDepositERC20 = (await stabilityPoolERC20.deposits(alice)).toString()
      const bob_initialDepositERC20 = (await stabilityPoolERC20.deposits(bob)).toString()

      assert.equal(alice_initialDeposit, dec(100, 18))
      assert.equal(bob_initialDeposit, '0')

      assert.equal(alice_initialDepositERC20, dec(100, 18))
      assert.equal(bob_initialDepositERC20, '0')

      const txAlice = await stabilityPool.withdrawFromSP(dec(100, 18), { from: alice })
      assert.isTrue(txAlice.receipt.status)

      const txAliceERC20 = await stabilityPoolERC20.withdrawFromSP(dec(100, 18), {
        from: alice,
      })
      assert.isTrue(txAliceERC20.receipt.status)

      try {
        const txBob = await stabilityPool.withdrawFromSP(dec(100, 18), { from: bob })
        assert.isFalse(txBob.receipt.status)
      } catch (err) {
        assert.include(err.message, 'revert')
        // TODO: infamous issue #99
        //assert.include(err.message, "User must have a non-zero deposit")
      }
      try {
        const txBob = await stabilityPoolERC20.withdrawFromSP(dec(100, 18), { from: bob })
        assert.isFalse(txBob.receipt.status)
      } catch (err) {
        assert.include(err.message, 'revert')
        // TODO: infamous issue #99
        //assert.include(err.message, "User must have a non-zero deposit")
      }
    })

    it('withdrawFromSP(): reverts when amount > 0 and system has an undercollateralized trove', async () => {
      await openTrove({
        extraDCHFAmount: toBN(dec(100, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: alice },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(100, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: alice },
      })

      await stabilityPool.provideToSP(dec(100, 18), { from: alice })
      await stabilityPoolERC20.provideToSP(dec(100, 18), { from: alice })

      const alice_initialDeposit = (await stabilityPool.deposits(alice)).toString()
      assert.equal(alice_initialDeposit, dec(100, 18))

      const alice_initialDepositERC20 = (await stabilityPoolERC20.deposits(alice)).toString()
      assert.equal(alice_initialDepositERC20, dec(100, 18))

      // defaulter opens trove
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })
      await openTrove({
        asset: erc20.address,
        ICR: toBN(dec(2, 18)),
        extraParams: { from: defaulter_1 },
      })

      // ETH drops, defaulter is in liquidation range (but not liquidated yet)
      await priceFeed.setPrice(dec(100, 18))

      await th.assertRevert(stabilityPool.withdrawFromSP(dec(100, 18), { from: alice }))
      await th.assertRevert(stabilityPoolERC20.withdrawFromSP(dec(100, 18), { from: alice }))
    })

    it('withdrawFromSP(): partial retrieval - retrieves correct DCHF amount and the entire ETH Gain, and updates deposit', async () => {
      // --- SETUP ---
      // Whale deposits 185000 DCHF in StabilityPool
      await openTrove({
        extraDCHFAmount: toBN(dec(2, 23)),
        ICR: toBN(dec(5, 18)),
        extraParams: { from: whale },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(2, 23)),
        ICR: toBN(dec(5, 18)),
        extraParams: { from: whale },
      })
      await stabilityPool.provideToSP(dec(185000, 18), { from: whale })
      await stabilityPoolERC20.provideToSP(dec(185000, 18), { from: whale })

      // 2 Troves opened
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_2 } })

      await openTrove({
        asset: erc20.address,
        ICR: toBN(dec(2, 18)),
        extraParams: { from: defaulter_1 },
      })
      await openTrove({
        asset: erc20.address,
        ICR: toBN(dec(2, 18)),
        extraParams: { from: defaulter_2 },
      })

      // --- TEST ---

      // Alice makes deposit #1: 15000 DCHF
      await openTrove({
        extraDCHFAmount: toBN(dec(15000, 18)),
        ICR: toBN(dec(5, 18)),
        extraParams: { from: alice },
      })
      await stabilityPool.provideToSP(dec(15000, 18), { from: alice })

      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(15000, 18)),
        ICR: toBN(dec(5, 18)),
        extraParams: { from: alice },
      })
      await stabilityPoolERC20.provideToSP(dec(15000, 18), { from: alice })

      // price drops: defaulters' Troves fall below MCR, alice and whale Trove remain active
      await priceFeed.setPrice(dec(105, 18))

      // 2 users with Trove with 170 DCHF drawn are closed
      const liquidationTX_1 = await troveManager.liquidate(ZERO_ADDRESS, defaulter_1, {
        from: owner,
      }) // 170 DCHF closed
      const liquidationTX_2 = await troveManager.liquidate(ZERO_ADDRESS, defaulter_2, {
        from: owner,
      }) // 170 DCHF closed

      const liquidationTX_1ERC20 = await troveManager.liquidate(erc20.address, defaulter_1, {
        from: owner,
      }) // 170 DCHF closed
      const liquidationTX_2ERC20 = await troveManager.liquidate(erc20.address, defaulter_2, {
        from: owner,
      }) // 170 DCHF closed

      const [liquidatedDebt_1] = th.getEmittedLiquidationValues(liquidationTX_1)
      const [liquidatedDebt_2] = th.getEmittedLiquidationValues(liquidationTX_2)

      const [liquidatedDebt_1ERC20] = th.getEmittedLiquidationValues(liquidationTX_1ERC20)
      const [liquidatedDebt_2ERC20] = th.getEmittedLiquidationValues(liquidationTX_2ERC20)

      // Alice DCHFLoss is ((15000/200000) * liquidatedDebt), for each liquidation
      const expectedDCHFLoss_A = liquidatedDebt_1
        .mul(toBN(dec(15000, 18)))
        .div(toBN(dec(200000, 18)))
        .add(liquidatedDebt_2.mul(toBN(dec(15000, 18))).div(toBN(dec(200000, 18))))

      const expectedDCHFLoss_AERC20 = liquidatedDebt_1ERC20
        .mul(toBN(dec(15000, 18)))
        .div(toBN(dec(200000, 18)))
        .add(liquidatedDebt_2ERC20.mul(toBN(dec(15000, 18))).div(toBN(dec(200000, 18))))

      const expectedCompoundedDCHFDeposit_A = toBN(dec(15000, 18)).sub(expectedDCHFLoss_A)
      const compoundedDCHFDeposit_A = await stabilityPool.getCompoundedDCHFDeposit(alice)

      const expectedCompoundedDCHFDeposit_AERC20 = toBN(dec(15000, 18)).sub(expectedDCHFLoss_AERC20)
      const compoundedDCHFDeposit_AERC20 = await stabilityPoolERC20.getCompoundedDCHFDeposit(alice)

      assert.isAtMost(th.getDifference(expectedCompoundedDCHFDeposit_A, compoundedDCHFDeposit_A), 100000)
      assert.isAtMost(
        th.getDifference(expectedCompoundedDCHFDeposit_AERC20, compoundedDCHFDeposit_AERC20),
        100000
      )

      // Alice retrieves part of her entitled DCHF: 9000 DCHF
      await stabilityPool.withdrawFromSP(dec(9000, 18), { from: alice })
      await stabilityPoolERC20.withdrawFromSP(dec(9000, 18), { from: alice })

      const expectedNewDeposit_A = compoundedDCHFDeposit_A.sub(toBN(dec(9000, 18)))
      const expectedNewDeposit_AERC20 = compoundedDCHFDeposit_AERC20.sub(toBN(dec(9000, 18)))

      // check Alice's deposit has been updated to equal her compounded deposit minus her withdrawal */
      const newDeposit = (await stabilityPool.deposits(alice)).toString()
      assert.isAtMost(th.getDifference(newDeposit, expectedNewDeposit_A), 100000)

      const newDepositERC20 = (await stabilityPoolERC20.deposits(alice)).toString()
      assert.isAtMost(th.getDifference(newDepositERC20, expectedNewDeposit_AERC20), 100000)

      // Expect Alice has withdrawn all ETH gain
      const alice_pendingETHGain = await stabilityPool.getDepositorAssetGain(alice)
      assert.equal(alice_pendingETHGain, 0)

      const alice_pendingETHGainERC20 = await stabilityPoolERC20.getDepositorAssetGain(alice)
      assert.equal(alice_pendingETHGainERC20, 0)
    })

    it('withdrawFromSP(): partial retrieval - leaves the correct amount of DCHF in the Stability Pool', async () => {
      // --- SETUP ---
      // Whale deposits 185000 DCHF in StabilityPool
      await openTrove({
        extraDCHFAmount: toBN(dec(2, 23)),
        ICR: toBN(dec(5, 18)),
        extraParams: { from: whale },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(2, 23)),
        ICR: toBN(dec(5, 18)),
        extraParams: { from: whale },
      })
      await stabilityPool.provideToSP(dec(185000, 18), { from: whale })
      await stabilityPoolERC20.provideToSP(dec(185000, 18), { from: whale })

      // 2 Troves opened
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_2 } })
      await openTrove({
        asset: erc20.address,
        ICR: toBN(dec(2, 18)),
        extraParams: { from: defaulter_1 },
      })
      await openTrove({
        asset: erc20.address,
        ICR: toBN(dec(2, 18)),
        extraParams: { from: defaulter_2 },
      })
      // --- TEST ---

      // Alice makes deposit #1: 15000 DCHF
      await openTrove({
        extraDCHFAmount: toBN(dec(15000, 18)),
        ICR: toBN(dec(5, 18)),
        extraParams: { from: alice },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(15000, 18)),
        ICR: toBN(dec(5, 18)),
        extraParams: { from: alice },
      })
      await stabilityPool.provideToSP(dec(15000, 18), { from: alice })
      await stabilityPoolERC20.provideToSP(dec(15000, 18), { from: alice })

      const SP_DCHF_Before = await stabilityPool.getTotalDCHFDeposits()
      assert.equal(SP_DCHF_Before, dec(200000, 18))

      const SP_DCHF_BeforeERC20 = await stabilityPoolERC20.getTotalDCHFDeposits()
      assert.equal(SP_DCHF_BeforeERC20, dec(200000, 18))

      // price drops: defaulters' Troves fall below MCR, alice and whale Trove remain active
      await priceFeed.setPrice(dec(105, 18))

      // 2 users liquidated
      const liquidationTX_1 = await troveManager.liquidate(ZERO_ADDRESS, defaulter_1, {
        from: owner,
      })
      const liquidationTX_2 = await troveManager.liquidate(ZERO_ADDRESS, defaulter_2, {
        from: owner,
      })

      const liquidationTX_1ERC20 = await troveManager.liquidate(erc20.address, defaulter_1, {
        from: owner,
      })
      const liquidationTX_2ERC20 = await troveManager.liquidate(erc20.address, defaulter_2, {
        from: owner,
      })

      const [liquidatedDebt_1] = await th.getEmittedLiquidationValues(liquidationTX_1)
      const [liquidatedDebt_2] = await th.getEmittedLiquidationValues(liquidationTX_2)
      const [liquidatedDebt_1ERC20] = await th.getEmittedLiquidationValues(liquidationTX_1ERC20)
      const [liquidatedDebt_2ERC20] = await th.getEmittedLiquidationValues(liquidationTX_2ERC20)

      // Alice retrieves part of her entitled DCHF: 9000 DCHF
      await stabilityPool.withdrawFromSP(dec(9000, 18), { from: alice })
      await stabilityPoolERC20.withdrawFromSP(dec(9000, 18), { from: alice })

      /* Check SP has reduced from 2 liquidations and Alice's withdrawal
      Expect DCHF in SP = (200000 - liquidatedDebt_1 - liquidatedDebt_2 - 9000) */
      const expectedSPDCHF = toBN(dec(200000, 18))
        .sub(toBN(liquidatedDebt_1))
        .sub(toBN(liquidatedDebt_2))
        .sub(toBN(dec(9000, 18)))

      const expectedSPDCHFERC20 = toBN(dec(200000, 18))
        .sub(toBN(liquidatedDebt_1ERC20))
        .sub(toBN(liquidatedDebt_2ERC20))
        .sub(toBN(dec(9000, 18)))

      const SP_DCHF_After = (await stabilityPool.getTotalDCHFDeposits()).toString()
      const SP_DCHF_AfterERC20 = (await stabilityPoolERC20.getTotalDCHFDeposits()).toString()

      th.assertIsApproximatelyEqual(SP_DCHF_After, expectedSPDCHF)
      th.assertIsApproximatelyEqual(SP_DCHF_AfterERC20, expectedSPDCHFERC20)
    })

    it('withdrawFromSP(): full retrieval - leaves the correct amount of DCHF in the Stability Pool', async () => {
      // --- SETUP ---
      // Whale deposits 185000 DCHF in StabilityPool
      await openTrove({
        extraDCHFAmount: toBN(dec(200000, 18)),
        ICR: toBN(dec(5, 18)),
        extraParams: { from: whale },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(200000, 18)),
        ICR: toBN(dec(5, 18)),
        extraParams: { from: whale },
      })
      await stabilityPool.provideToSP(dec(185000, 18), { from: whale })
      await stabilityPoolERC20.provideToSP(dec(185000, 18), { from: whale })

      // 2 Troves opened
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_2 } })

      await openTrove({
        asset: erc20.address,
        ICR: toBN(dec(2, 18)),
        extraParams: { from: defaulter_1 },
      })
      await openTrove({
        asset: erc20.address,
        ICR: toBN(dec(2, 18)),
        extraParams: { from: defaulter_2 },
      })

      // --- TEST ---

      // Alice makes deposit #1
      await openTrove({
        extraDCHFAmount: toBN(dec(15000, 18)),
        ICR: toBN(dec(5, 18)),
        extraParams: { from: alice },
      })
      await stabilityPool.provideToSP(dec(15000, 18), { from: alice })

      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(15000, 18)),
        ICR: toBN(dec(5, 18)),
        extraParams: { from: alice },
      })
      await stabilityPoolERC20.provideToSP(dec(15000, 18), { from: alice })

      const SP_DCHF_Before = await stabilityPool.getTotalDCHFDeposits()
      assert.equal(SP_DCHF_Before, dec(200000, 18))

      const SP_DCHF_BeforeERC20 = await stabilityPoolERC20.getTotalDCHFDeposits()
      assert.equal(SP_DCHF_BeforeERC20, dec(200000, 18))

      // price drops: defaulters' Troves fall below MCR, alice and whale Trove remain active
      await priceFeed.setPrice(dec(105, 18))

      // 2 defaulters liquidated
      const liquidationTX_1 = await troveManager.liquidate(ZERO_ADDRESS, defaulter_1, {
        from: owner,
      })
      const liquidationTX_2 = await troveManager.liquidate(ZERO_ADDRESS, defaulter_2, {
        from: owner,
      })

      const liquidationTX_1ERC20 = await troveManager.liquidate(erc20.address, defaulter_1, {
        from: owner,
      })
      const liquidationTX_2ERC20 = await troveManager.liquidate(erc20.address, defaulter_2, {
        from: owner,
      })

      const [liquidatedDebt_1] = await th.getEmittedLiquidationValues(liquidationTX_1)
      const [liquidatedDebt_2] = await th.getEmittedLiquidationValues(liquidationTX_2)

      const [liquidatedDebt_1ERC20] = await th.getEmittedLiquidationValues(liquidationTX_1ERC20)
      const [liquidatedDebt_2ERC20] = await th.getEmittedLiquidationValues(liquidationTX_2ERC20)

      // Alice DCHFLoss is ((15000/200000) * liquidatedDebt), for each liquidation
      const expectedDCHFLoss_A = liquidatedDebt_1
        .mul(toBN(dec(15000, 18)))
        .div(toBN(dec(200000, 18)))
        .add(liquidatedDebt_2.mul(toBN(dec(15000, 18))).div(toBN(dec(200000, 18))))

      const expectedDCHFLoss_AERC20 = liquidatedDebt_1ERC20
        .mul(toBN(dec(15000, 18)))
        .div(toBN(dec(200000, 18)))
        .add(liquidatedDebt_2ERC20.mul(toBN(dec(15000, 18))).div(toBN(dec(200000, 18))))

      const expectedCompoundedDCHFDeposit_A = toBN(dec(15000, 18)).sub(expectedDCHFLoss_A)
      const compoundedDCHFDeposit_A = await stabilityPool.getCompoundedDCHFDeposit(alice)

      const expectedCompoundedDCHFDeposit_AERC20 = toBN(dec(15000, 18)).sub(expectedDCHFLoss_AERC20)
      const compoundedDCHFDeposit_AERC20 = await stabilityPoolERC20.getCompoundedDCHFDeposit(alice)

      assert.isAtMost(th.getDifference(expectedCompoundedDCHFDeposit_A, compoundedDCHFDeposit_A), 100000)
      assert.isAtMost(
        th.getDifference(expectedCompoundedDCHFDeposit_AERC20, compoundedDCHFDeposit_AERC20),
        100000
      )

      const DCHFinSPBefore = await stabilityPool.getTotalDCHFDeposits()
      const DCHFinSPBeforeERC20 = await stabilityPoolERC20.getTotalDCHFDeposits()

      // Alice retrieves all of her entitled DCHF:
      await stabilityPool.withdrawFromSP(dec(15000, 18), { from: alice })
      await stabilityPoolERC20.withdrawFromSP(dec(15000, 18), { from: alice })

      const expectedDCHFinSPAfter = DCHFinSPBefore.sub(compoundedDCHFDeposit_A)
      const expectedDCHFinSPAfterERC20 = DCHFinSPBefore.sub(compoundedDCHFDeposit_AERC20)

      const DCHFinSPAfter = await stabilityPool.getTotalDCHFDeposits()
      const DCHFinSPAfterERC20 = await stabilityPoolERC20.getTotalDCHFDeposits()
      assert.isAtMost(th.getDifference(expectedDCHFinSPAfter, DCHFinSPAfter), 100000)
      assert.isAtMost(th.getDifference(expectedDCHFinSPAfterERC20, DCHFinSPAfterERC20), 100000)
    })

    it('withdrawFromSP(): Subsequent deposit and withdrawal attempt from same account, with no intermediate liquidations, withdraws zero ETH', async () => {
      // --- SETUP ---
      // Whale deposits 1850 DCHF in StabilityPool
      await openTrove({
        extraDCHFAmount: toBN(dec(1000000, 18)),
        ICR: toBN(dec(10, 18)),
        extraParams: { from: whale },
      })
      await stabilityPool.provideToSP(dec(18500, 18), { from: whale })

      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(1000000, 18)),
        ICR: toBN(dec(10, 18)),
        extraParams: { from: whale },
      })
      await stabilityPoolERC20.provideToSP(dec(18500, 18), { from: whale })

      // 2 defaulters open
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_2 } })

      await openTrove({
        asset: erc20.address,
        ICR: toBN(dec(2, 18)),
        extraParams: { from: defaulter_1 },
      })
      await openTrove({
        asset: erc20.address,
        ICR: toBN(dec(2, 18)),
        extraParams: { from: defaulter_2 },
      })

      // --- TEST ---

      // Alice makes deposit #1: 15000 DCHF
      await openTrove({
        extraDCHFAmount: toBN(dec(15000, 18)),
        ICR: toBN(dec(10, 18)),
        extraParams: { from: alice },
      })
      await stabilityPool.provideToSP(dec(15000, 18), { from: alice })

      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(15000, 18)),
        ICR: toBN(dec(10, 18)),
        extraParams: { from: alice },
      })
      await stabilityPoolERC20.provideToSP(dec(15000, 18), { from: alice })

      // price drops: defaulters' Troves fall below MCR, alice and whale Trove remain active
      await priceFeed.setPrice(dec(105, 18))

      // defaulters liquidated
      await troveManager.liquidate(ZERO_ADDRESS, defaulter_1, { from: owner })
      await troveManager.liquidate(ZERO_ADDRESS, defaulter_2, { from: owner })

      await troveManager.liquidate(erc20.address, defaulter_1, { from: owner })
      await troveManager.liquidate(erc20.address, defaulter_2, { from: owner })

      // Alice retrieves all of her entitled DCHF:
      await stabilityPool.withdrawFromSP(dec(15000, 18), { from: alice })
      assert.equal(await stabilityPool.getDepositorAssetGain(alice), 0)

      await stabilityPoolERC20.withdrawFromSP(dec(15000, 18), { from: alice })
      assert.equal(await stabilityPoolERC20.getDepositorAssetGain(alice), 0)

      // Alice makes second deposit
      await stabilityPool.provideToSP(dec(10000, 18), { from: alice })
      assert.equal(await stabilityPool.getDepositorAssetGain(alice), 0)

      await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: alice })
      assert.equal(await stabilityPoolERC20.getDepositorAssetGain(alice), 0)

      const ETHinSP_Before = (await stabilityPool.getAssetBalance()).toString()
      const ETHinSP_BeforeERC20 = (await stabilityPoolERC20.getAssetBalance()).toString()

      // Alice attempts second withdrawal
      await stabilityPool.withdrawFromSP(dec(10000, 18), { from: alice })
      assert.equal(await stabilityPool.getDepositorAssetGain(alice), 0)

      await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), { from: alice })
      assert.equal(await stabilityPoolERC20.getDepositorAssetGain(alice), 0)

      // Check ETH in pool does not change
      const ETHinSP_1 = (await stabilityPool.getAssetBalance()).toString()
      assert.equal(ETHinSP_Before, ETHinSP_1)

      const ETHinSP_1ERC20 = (await stabilityPoolERC20.getAssetBalance()).toString()
      assert.equal(ETHinSP_BeforeERC20, ETHinSP_1ERC20)

      // Third deposit
      await stabilityPool.provideToSP(dec(10000, 18), { from: alice })
      assert.equal(await stabilityPool.getDepositorAssetGain(alice), 0)

      await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: alice })
      assert.equal(await stabilityPoolERC20.getDepositorAssetGain(alice), 0)

      // Alice attempts third withdrawal (this time, frm SP to Trove)
      const txPromise_A = stabilityPool.withdrawAssetGainToTrove(alice, alice, { from: alice })
      await th.assertRevert(txPromise_A)

      const txPromise_AERC20 = stabilityPoolERC20.withdrawAssetGainToTrove(alice, alice, {
        from: alice,
      })
      await th.assertRevert(txPromise_AERC20)
    })

    it("withdrawFromSP(): it correctly updates the user's DCHF and ETH snapshots of entitled reward per unit staked", async () => {
      // --- SETUP ---
      // Whale deposits 185000 DCHF in StabilityPool
      await openTrove({
        extraDCHFAmount: toBN(dec(1000000, 18)),
        ICR: toBN(dec(10, 18)),
        extraParams: { from: whale },
      })
      await stabilityPool.provideToSP(dec(185000, 18), { from: whale })

      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(1000000, 18)),
        ICR: toBN(dec(10, 18)),
        extraParams: { from: whale },
      })
      await stabilityPoolERC20.provideToSP(dec(185000, 18), { from: whale })

      // 2 defaulters open
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_2 } })

      await openTrove({
        asset: erc20.address,
        ICR: toBN(dec(2, 18)),
        extraParams: { from: defaulter_1 },
      })
      await openTrove({
        asset: erc20.address,
        ICR: toBN(dec(2, 18)),
        extraParams: { from: defaulter_2 },
      })

      // --- TEST ---

      // Alice makes deposit #1: 15000 DCHF
      await openTrove({
        extraDCHFAmount: toBN(dec(15000, 18)),
        ICR: toBN(dec(10, 18)),
        extraParams: { from: alice },
      })
      await stabilityPool.provideToSP(dec(15000, 18), { from: alice })

      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(15000, 18)),
        ICR: toBN(dec(10, 18)),
        extraParams: { from: alice },
      })
      await stabilityPoolERC20.provideToSP(dec(15000, 18), { from: alice })

      // check 'Before' snapshots
      const alice_snapshot_Before = await stabilityPool.depositSnapshots(alice)
      const alice_snapshot_S_Before = alice_snapshot_Before[0].toString()
      const alice_snapshot_P_Before = alice_snapshot_Before[1].toString()
      assert.equal(alice_snapshot_S_Before, 0)
      assert.equal(alice_snapshot_P_Before, '1000000000000000000')

      const alice_snapshot_BeforeERC20 = await stabilityPoolERC20.depositSnapshots(alice)
      const alice_snapshot_S_BeforeERC20 = alice_snapshot_BeforeERC20[0].toString()
      const alice_snapshot_P_BeforeERC20 = alice_snapshot_BeforeERC20[1].toString()
      assert.equal(alice_snapshot_S_BeforeERC20, 0)
      assert.equal(alice_snapshot_P_BeforeERC20, '1000000000000000000')

      // price drops: defaulters' Troves fall below MCR, alice and whale Trove remain active
      await priceFeed.setPrice(dec(105, 18))

      // 2 defaulters liquidated
      await troveManager.liquidate(ZERO_ADDRESS, defaulter_1, { from: owner })
      await troveManager.liquidate(ZERO_ADDRESS, defaulter_2, { from: owner })

      await troveManager.liquidate(erc20.address, defaulter_1, { from: owner })
      await troveManager.liquidate(erc20.address, defaulter_2, { from: owner })

      // Alice retrieves part of her entitled DCHF: 9000 DCHF
      await stabilityPool.withdrawFromSP(dec(9000, 18), { from: alice })
      await stabilityPoolERC20.withdrawFromSP(dec(9000, 18), { from: alice })

      const P = (await stabilityPool.P()).toString()
      const S = (await stabilityPool.epochToScaleToSum(0, 0)).toString()
      // check 'After' snapshots
      const alice_snapshot_After = await stabilityPool.depositSnapshots(alice)
      const alice_snapshot_S_After = alice_snapshot_After[0].toString()
      const alice_snapshot_P_After = alice_snapshot_After[1].toString()
      assert.equal(alice_snapshot_S_After, S)
      assert.equal(alice_snapshot_P_After, P)

      const PERC20 = (await stabilityPoolERC20.P()).toString()
      const SERC20 = (await stabilityPoolERC20.epochToScaleToSum(0, 0)).toString()
      // check 'After' snapshots
      const alice_snapshot_AfterERC20 = await stabilityPoolERC20.depositSnapshots(alice)
      const alice_snapshot_S_AfterERC20 = alice_snapshot_AfterERC20[0].toString()
      const alice_snapshot_P_AfterERC20 = alice_snapshot_AfterERC20[1].toString()
      assert.equal(alice_snapshot_S_AfterERC20, SERC20)
      assert.equal(alice_snapshot_P_AfterERC20, PERC20)
    })

    it('withdrawFromSP(): decreases StabilityPool ETH', async () => {
      // --- SETUP ---
      // Whale deposits 185000 DCHF in StabilityPool
      await openTrove({
        extraDCHFAmount: toBN(dec(200000, 18)),
        ICR: toBN(dec(5, 18)),
        extraParams: { from: whale },
      })
      await stabilityPool.provideToSP(dec(185000, 18), { from: whale })

      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(200000, 18)),
        ICR: toBN(dec(5, 18)),
        extraParams: { from: whale },
      })
      await stabilityPoolERC20.provideToSP(dec(185000, 18), { from: whale })

      // 1 defaulter opens
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })
      await openTrove({
        asset: erc20.address,
        ICR: toBN(dec(2, 18)),
        extraParams: { from: defaulter_1 },
      })

      // --- TEST ---

      // Alice makes deposit #1: 15000 DCHF
      await openTrove({
        extraDCHFAmount: toBN(dec(15000, 18)),
        ICR: toBN(dec(5, 18)),
        extraParams: { from: alice },
      })
      await stabilityPool.provideToSP(dec(15000, 18), { from: alice })

      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(15000, 18)),
        ICR: toBN(dec(5, 18)),
        extraParams: { from: alice },
      })
      await stabilityPoolERC20.provideToSP(dec(15000, 18), { from: alice })

      // price drops: defaulter's Trove falls below MCR, alice and whale Trove remain active
      await priceFeed.setPrice('100000000000000000000')

      // defaulter's Trove is closed.
      const liquidationTx_1 = await troveManager.liquidate(ZERO_ADDRESS, defaulter_1, {
        from: owner,
      }) // 180 DCHF closed
      const [, liquidatedColl] = th.getEmittedLiquidationValues(liquidationTx_1)

      const liquidationTx_1ERC20 = await troveManager.liquidate(erc20.address, defaulter_1, {
        from: owner,
      }) // 180 DCHF closed
      const [, liquidatedCollERC20] = th.getEmittedLiquidationValues(liquidationTx_1ERC20)

      // Get ActivePool and StabilityPool Ether before retrieval:
      const active_ETH_Before = await activePool.getAssetBalance(ZERO_ADDRESS)
      const stability_ETH_Before = await stabilityPool.getAssetBalance()

      const active_ETH_BeforeERC20 = await activePool.getAssetBalance(erc20.address)
      const stability_ETH_BeforeERC20 = await stabilityPoolERC20.getAssetBalance()

      // Expect alice to be entitled to 15000/200000 of the liquidated coll
      const aliceExpectedETHGain = liquidatedColl.mul(toBN(dec(15000, 18))).div(toBN(dec(200000, 18)))
      const aliceETHGain = await stabilityPool.getDepositorAssetGain(alice)
      assert.isTrue(aliceExpectedETHGain.eq(aliceETHGain))

      const aliceExpectedETHGainERC20 = liquidatedCollERC20
        .mul(toBN(dec(15000, 18)))
        .div(toBN(dec(200000, 18)))
      const aliceETHGainERC20 = await stabilityPoolERC20.getDepositorAssetGain(alice)
      assert.isTrue(aliceExpectedETHGainERC20.div(toBN(10 ** 10)).eq(aliceETHGainERC20))

      // Alice retrieves all of her deposit
      await stabilityPool.withdrawFromSP(dec(15000, 18), { from: alice })
      await stabilityPoolERC20.withdrawFromSP(dec(15000, 18), { from: alice })

      const active_ETH_After = await activePool.getAssetBalance(ZERO_ADDRESS)
      const stability_ETH_After = await stabilityPool.getAssetBalance()

      const active_ETH_AfterERC20 = await activePool.getAssetBalance(erc20.address)
      const stability_ETH_AfterERC20 = await stabilityPoolERC20.getAssetBalance()

      const active_ETH_Difference = active_ETH_Before.sub(active_ETH_After)
      const stability_ETH_Difference = stability_ETH_Before.sub(stability_ETH_After)

      const active_ETH_DifferenceERC20 = active_ETH_BeforeERC20.sub(active_ETH_AfterERC20)
      const stability_ETH_DifferenceERC20 = stability_ETH_BeforeERC20.sub(stability_ETH_AfterERC20)

      assert.equal(active_ETH_Difference, '0')
      assert.equal(active_ETH_DifferenceERC20, '0')

      // Expect StabilityPool to have decreased by Alice's AssetGain
      assert.isAtMost(th.getDifference(stability_ETH_Difference, aliceETHGain), 10000)
      assert.isAtMost(
        th.getDifference(stability_ETH_DifferenceERC20.div(toBN(10 ** 10)), aliceETHGainERC20),
        10000
      )
    })

    it('withdrawFromSP(): All depositors are able to withdraw from the SP to their account', async () => {
      // Whale opens trove
      await openTrove({ ICR: toBN(dec(10, 18)), extraParams: { from: whale } })
      await openTrove({
        asset: erc20.address,
        ICR: toBN(dec(10, 18)),
        extraParams: { from: whale },
      })

      // 1 defaulter open
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })
      await openTrove({
        asset: erc20.address,
        ICR: toBN(dec(2, 18)),
        extraParams: { from: defaulter_1 },
      })

      // 6 Accounts open troves and provide to SP
      const depositors = [alice, bob, carol, dennis, erin, flyn]
      for (account of depositors) {
        await openTrove({
          extraDCHFAmount: toBN(dec(10000, 18)),
          ICR: toBN(dec(2, 18)),
          extraParams: { from: account },
        })
        await stabilityPool.provideToSP(dec(10000, 18), { from: account })
      }

      for (account of depositors) {
        await openTrove({
          asset: erc20.address,
          extraDCHFAmount: toBN(dec(10000, 18)),
          ICR: toBN(dec(2, 18)),
          extraParams: { from: account },
        })
        await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: account })
      }

      await priceFeed.setPrice(dec(105, 18))
      await troveManager.liquidate(ZERO_ADDRESS, defaulter_1)
      await troveManager.liquidate(erc20.address, defaulter_1)

      await priceFeed.setPrice(dec(200, 18))

      // All depositors attempt to withdraw
      await stabilityPool.withdrawFromSP(dec(10000, 18), { from: alice })
      assert.equal((await stabilityPool.deposits(alice)).toString(), '0')
      await stabilityPool.withdrawFromSP(dec(10000, 18), { from: bob })
      assert.equal((await stabilityPool.deposits(alice)).toString(), '0')
      await stabilityPool.withdrawFromSP(dec(10000, 18), { from: carol })
      assert.equal((await stabilityPool.deposits(alice)).toString(), '0')
      await stabilityPool.withdrawFromSP(dec(10000, 18), { from: dennis })
      assert.equal((await stabilityPool.deposits(alice)).toString(), '0')
      await stabilityPool.withdrawFromSP(dec(10000, 18), { from: erin })
      assert.equal((await stabilityPool.deposits(alice)).toString(), '0')
      await stabilityPool.withdrawFromSP(dec(10000, 18), { from: flyn })
      assert.equal((await stabilityPool.deposits(alice)).toString(), '0')

      await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), { from: alice })
      assert.equal((await stabilityPoolERC20.deposits(alice)).toString(), '0')
      await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), { from: bob })
      assert.equal((await stabilityPoolERC20.deposits(alice)).toString(), '0')
      await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), { from: carol })
      assert.equal((await stabilityPoolERC20.deposits(alice)).toString(), '0')
      await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), { from: dennis })
      assert.equal((await stabilityPoolERC20.deposits(alice)).toString(), '0')
      await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), { from: erin })
      assert.equal((await stabilityPoolERC20.deposits(alice)).toString(), '0')
      await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), { from: flyn })
      assert.equal((await stabilityPoolERC20.deposits(alice)).toString(), '0')

      const totalDeposits = (await stabilityPool.getTotalDCHFDeposits()).toString()
      const totalDepositsERC20 = (await stabilityPoolERC20.getTotalDCHFDeposits()).toString()

      assert.isAtMost(th.getDifference(totalDeposits, '0'), 100000)
      assert.isAtMost(th.getDifference(totalDepositsERC20, '0'), 100000)
    })

    it("withdrawFromSP(): increases depositor's DCHF token balance by the expected amount", async () => {
      // Whale opens trove
      await openTrove({
        extraDCHFAmount: toBN(dec(100000, 18)),
        ICR: toBN(dec(10, 18)),
        extraParams: { from: whale },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(100000, 18)),
        ICR: toBN(dec(10, 18)),
        extraParams: { from: whale },
      })

      // 1 defaulter opens trove
      await borrowerOperations.openTrove(
        ZERO_ADDRESS,
        0,
        th._100pct,
        await getOpenTroveDCHFAmount(dec(10000, 18), ZERO_ADDRESS),
        defaulter_1,
        defaulter_1,
        { from: defaulter_1, value: dec(100, 'ether') }
      )
      await borrowerOperations.openTrove(
        erc20.address,
        dec(100, 'ether'),
        th._100pct,
        await getOpenTroveDCHFAmount(dec(10000, 18), ZERO_ADDRESS),
        defaulter_1,
        defaulter_1,
        { from: defaulter_1 }
      )

      const defaulterDebt = (await troveManagerHelpers.getEntireDebtAndColl(ZERO_ADDRESS, defaulter_1))[0]
      const defaulterDebtERC20 = (
        await troveManagerHelpers.getEntireDebtAndColl(erc20.address, defaulter_1)
      )[0]

      // 6 Accounts open troves and provide to SP
      const depositors = [alice, bob, carol, dennis, erin, flyn]

      for (account of depositors) {
        await openTrove({
          extraDCHFAmount: toBN(dec(10000, 18)),
          ICR: toBN(dec(2, 18)),
          extraParams: { from: account },
        })
        await stabilityPool.provideToSP(dec(10000, 18), { from: account })
      }

      for (account of depositors) {
        await openTrove({
          asset: erc20.address,
          extraDCHFAmount: toBN(dec(10000, 18)),
          ICR: toBN(dec(2, 18)),
          extraParams: { from: account },
        })
        await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: account })
      }

      await priceFeed.setPrice(dec(105, 18))
      await troveManager.liquidate(ZERO_ADDRESS, defaulter_1)
      await troveManager.liquidate(erc20.address, defaulter_1)

      const aliceBalBefore = await dchfToken.balanceOf(alice)
      const bobBalBefore = await dchfToken.balanceOf(bob)

      /* From an offset of 10000 DCHF, each depositor receives
      DCHFLoss = 1666.6666666666666666 DCHF

      and thus with a deposit of 10000 DCHF, each should withdraw 8333.3333333333333333 DCHF (in practice, slightly less due to rounding error)
      */

      // Price bounces back to $200 per ETH
      await priceFeed.setPrice(dec(200, 18))

      // Bob issues a further 5000 DCHF from his trove
      await borrowerOperations.withdrawDCHF(ZERO_ADDRESS, th._100pct, dec(5000, 18), bob, bob, { from: bob })
      await borrowerOperations.withdrawDCHF(erc20.address, th._100pct, dec(5000, 18), bob, bob, { from: bob })

      // Expect Alice's DCHF balance increase be very close to 8333.3333333333333333 DCHF
      await stabilityPool.withdrawFromSP(dec(10000, 18), { from: alice })
      await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), { from: alice })
      const aliceBalance = await dchfToken.balanceOf(alice)

      assert.isAtMost(
        th.getDifference(aliceBalance.sub(aliceBalBefore), toBN('8333333333333333333333').mul(toBN(2))),
        200000
      )

      // expect Bob's DCHF balance increase to be very close to  13333.33333333333333333 DCHF
      await stabilityPool.withdrawFromSP(dec(10000, 18), { from: bob })
      await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), { from: bob })
      const bobBalance = await dchfToken.balanceOf(bob)
      assert.isAtMost(
        th.getDifference(bobBalance.sub(bobBalBefore), toBN('13333333333333333333333').mul(toBN(2))),
        200000
      )
    })

    it("withdrawFromSP(): doesn't impact other users Stability deposits or ETH gains", async () => {
      await openTrove({
        extraDCHFAmount: toBN(dec(100000, 18)),
        ICR: toBN(dec(10, 18)),
        extraParams: { from: whale },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(100000, 18)),
        ICR: toBN(dec(10, 18)),
        extraParams: { from: whale },
      })

      // A, B, C open troves and make Stability Pool deposits
      await openTrove({
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: alice },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(20000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: bob },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(30000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: carol },
      })

      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: alice },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(20000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: bob },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(30000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: carol },
      })

      await stabilityPool.provideToSP(dec(10000, 18), { from: alice })
      await stabilityPool.provideToSP(dec(20000, 18), { from: bob })
      await stabilityPool.provideToSP(dec(30000, 18), { from: carol })

      await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: alice })
      await stabilityPoolERC20.provideToSP(dec(20000, 18), { from: bob })
      await stabilityPoolERC20.provideToSP(dec(30000, 18), { from: carol })

      // Would-be defaulters open troves
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_2 } })

      await openTrove({
        asset: erc20.address,
        ICR: toBN(dec(2, 18)),
        extraParams: { from: defaulter_1 },
      })
      await openTrove({
        asset: erc20.address,
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

      const alice_DCHFDeposit_BeforeERC20 = (
        await stabilityPoolERC20.getCompoundedDCHFDeposit(alice)
      ).toString()
      const bob_DCHFDeposit_BeforeERC20 = (await stabilityPoolERC20.getCompoundedDCHFDeposit(bob)).toString()

      const alice_ETHGain_Before = (await stabilityPool.getDepositorAssetGain(alice)).toString()
      const bob_ETHGain_Before = (await stabilityPool.getDepositorAssetGain(bob)).toString()

      const alice_ETHGain_BeforeERC20 = (await stabilityPoolERC20.getDepositorAssetGain(alice)).toString()
      const bob_ETHGain_BeforeERC20 = (await stabilityPoolERC20.getDepositorAssetGain(bob)).toString()

      //check non-zero DCHF and AssetGain in the Stability Pool
      const DCHFinSP = await stabilityPool.getTotalDCHFDeposits()
      const ETHinSP = await stabilityPool.getAssetBalance()
      const DCHFinSPERC20 = await stabilityPoolERC20.getTotalDCHFDeposits()
      const ETHinSPERC20 = await stabilityPoolERC20.getAssetBalance()
      assert.isTrue(DCHFinSP.gt(mv._zeroBN))
      assert.isTrue(ETHinSP.gt(mv._zeroBN))
      assert.isTrue(DCHFinSPERC20.gt(mv._zeroBN))
      assert.isTrue(ETHinSPERC20.gt(mv._zeroBN))

      // Price rises
      await priceFeed.setPrice(dec(200, 18))

      // Carol withdraws her Stability deposit
      assert.equal((await stabilityPool.deposits(carol)).toString(), dec(30000, 18))
      assert.equal((await stabilityPoolERC20.deposits(carol)).toString(), dec(30000, 18))

      await stabilityPool.withdrawFromSP(dec(30000, 18), { from: carol })
      await stabilityPoolERC20.withdrawFromSP(dec(30000, 18), { from: carol })

      assert.equal((await stabilityPool.deposits(carol)).toString(), '0')
      assert.equal((await stabilityPoolERC20.deposits(carol)).toString(), '0')

      const alice_DCHFDeposit_After = (await stabilityPool.getCompoundedDCHFDeposit(alice)).toString()
      const bob_DCHFDeposit_After = (await stabilityPool.getCompoundedDCHFDeposit(bob)).toString()

      const alice_ETHGain_After = (await stabilityPool.getDepositorAssetGain(alice)).toString()
      const bob_ETHGain_After = (await stabilityPool.getDepositorAssetGain(bob)).toString()

      const alice_DCHFDeposit_AfterERC20 = (
        await stabilityPoolERC20.getCompoundedDCHFDeposit(alice)
      ).toString()
      const bob_DCHFDeposit_AfterERC20 = (await stabilityPoolERC20.getCompoundedDCHFDeposit(bob)).toString()

      const alice_ETHGain_AfterERC20 = (await stabilityPoolERC20.getDepositorAssetGain(alice)).toString()
      const bob_ETHGain_AfterERC20 = (await stabilityPoolERC20.getDepositorAssetGain(bob)).toString()

      // Check compounded deposits and ETH gains for A and B have not changed
      assert.equal(alice_DCHFDeposit_Before, alice_DCHFDeposit_After)
      assert.equal(bob_DCHFDeposit_Before, bob_DCHFDeposit_After)
      assert.equal(alice_ETHGain_Before, alice_ETHGain_After)
      assert.equal(bob_ETHGain_Before, bob_ETHGain_After)

      assert.equal(alice_DCHFDeposit_BeforeERC20, alice_DCHFDeposit_AfterERC20)
      assert.equal(bob_DCHFDeposit_BeforeERC20, bob_DCHFDeposit_AfterERC20)
      assert.equal(alice_ETHGain_BeforeERC20, alice_ETHGain_AfterERC20)
      assert.equal(bob_ETHGain_BeforeERC20, bob_ETHGain_AfterERC20)
    })

    it("withdrawFromSP(): doesn't impact system debt, collateral or TCR ", async () => {
      await openTrove({
        extraDCHFAmount: toBN(dec(100000, 18)),
        ICR: toBN(dec(10, 18)),
        extraParams: { from: whale },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(100000, 18)),
        ICR: toBN(dec(10, 18)),
        extraParams: { from: whale },
      })

      // A, B, C open troves and make Stability Pool deposits
      await openTrove({
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: alice },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(20000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: bob },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(30000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: carol },
      })

      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: alice },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(20000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: bob },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(30000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: carol },
      })

      await stabilityPool.provideToSP(dec(10000, 18), { from: alice })
      await stabilityPool.provideToSP(dec(20000, 18), { from: bob })
      await stabilityPool.provideToSP(dec(30000, 18), { from: carol })

      await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: alice })
      await stabilityPoolERC20.provideToSP(dec(20000, 18), { from: bob })
      await stabilityPoolERC20.provideToSP(dec(30000, 18), { from: carol })

      // Would-be defaulters open troves
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_2 } })

      await openTrove({
        asset: erc20.address,
        ICR: toBN(dec(2, 18)),
        extraParams: { from: defaulter_1 },
      })
      await openTrove({
        asset: erc20.address,
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

      // Price rises
      await priceFeed.setPrice(dec(200, 18))

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

      // Carol withdraws her Stability deposit
      assert.equal((await stabilityPool.deposits(carol)).toString(), dec(30000, 18))
      await stabilityPool.withdrawFromSP(dec(30000, 18), { from: carol })
      assert.equal((await stabilityPool.deposits(carol)).toString(), '0')

      assert.equal((await stabilityPoolERC20.deposits(carol)).toString(), dec(30000, 18))
      await stabilityPoolERC20.withdrawFromSP(dec(30000, 18), { from: carol })
      assert.equal((await stabilityPoolERC20.deposits(carol)).toString(), '0')

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

    it("withdrawFromSP(): doesn't impact any troves, including the caller's trove", async () => {
      await openTrove({
        extraDCHFAmount: toBN(dec(100000, 18)),
        ICR: toBN(dec(10, 18)),
        extraParams: { from: whale },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(100000, 18)),
        ICR: toBN(dec(10, 18)),
        extraParams: { from: whale },
      })

      // A, B, C open troves and make Stability Pool deposits
      await openTrove({
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: alice },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(20000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: bob },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(30000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: carol },
      })

      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: alice },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(20000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: bob },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(30000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: carol },
      })

      // A, B and C provide to SP
      await stabilityPool.provideToSP(dec(10000, 18), { from: alice })
      await stabilityPool.provideToSP(dec(20000, 18), { from: bob })
      await stabilityPool.provideToSP(dec(30000, 18), { from: carol })

      await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: alice })
      await stabilityPoolERC20.provideToSP(dec(20000, 18), { from: bob })
      await stabilityPoolERC20.provideToSP(dec(30000, 18), { from: carol })

      // Price drops
      await priceFeed.setPrice(dec(105, 18))
      const price = await priceFeed.getPrice()

      // Get debt, collateral and ICR of all existing troves
      const whale_Debt_Before = (await troveManagerHelpers.Troves(whale, ZERO_ADDRESS))[0].toString()
      const alice_Debt_Before = (await troveManagerHelpers.Troves(alice, ZERO_ADDRESS))[0].toString()
      const bob_Debt_Before = (await troveManagerHelpers.Troves(bob, ZERO_ADDRESS))[0].toString()
      const carol_Debt_Before = (await troveManagerHelpers.Troves(carol, ZERO_ADDRESS))[0].toString()

      const whale_Debt_BeforeERC20 = (await troveManagerHelpers.Troves(whale, erc20.address))[0].toString()
      const alice_Debt_BeforeERC20 = (await troveManagerHelpers.Troves(alice, erc20.address))[0].toString()
      const bob_Debt_BeforeERC20 = (await troveManagerHelpers.Troves(bob, erc20.address))[0].toString()
      const carol_Debt_BeforeERC20 = (await troveManagerHelpers.Troves(carol, erc20.address))[0].toString()

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

      // price rises
      await priceFeed.setPrice(dec(200, 18))

      // Carol withdraws her Stability deposit
      assert.equal((await stabilityPool.deposits(carol)).toString(), dec(30000, 18))
      await stabilityPool.withdrawFromSP(dec(30000, 18), { from: carol })
      assert.equal((await stabilityPool.deposits(carol)).toString(), '0')

      assert.equal((await stabilityPoolERC20.deposits(carol)).toString(), dec(30000, 18))
      await stabilityPoolERC20.withdrawFromSP(dec(30000, 18), { from: carol })
      assert.equal((await stabilityPoolERC20.deposits(carol)).toString(), '0')

      const whale_Debt_After = (await troveManagerHelpers.Troves(whale, ZERO_ADDRESS))[0].toString()
      const alice_Debt_After = (await troveManagerHelpers.Troves(alice, ZERO_ADDRESS))[0].toString()
      const bob_Debt_After = (await troveManagerHelpers.Troves(bob, ZERO_ADDRESS))[0].toString()
      const carol_Debt_After = (await troveManagerHelpers.Troves(carol, ZERO_ADDRESS))[0].toString()

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

      const whale_ICR_After = (await troveManagerHelpers.getCurrentICR(ZERO_ADDRESS, whale, price)).toString()
      const alice_ICR_After = (await troveManagerHelpers.getCurrentICR(ZERO_ADDRESS, alice, price)).toString()
      const bob_ICR_After = (await troveManagerHelpers.getCurrentICR(ZERO_ADDRESS, bob, price)).toString()
      const carol_ICR_After = (await troveManagerHelpers.getCurrentICR(ZERO_ADDRESS, carol, price)).toString()

      const whale_Debt_AfterERC20 = (await troveManagerHelpers.Troves(whale, erc20.address))[0].toString()
      const alice_Debt_AfterERC20 = (await troveManagerHelpers.Troves(alice, erc20.address))[0].toString()
      const bob_Debt_AfterERC20 = (await troveManagerHelpers.Troves(bob, erc20.address))[0].toString()
      const carol_Debt_AfterERC20 = (await troveManagerHelpers.Troves(carol, erc20.address))[0].toString()

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

      // Check all troves are unaffected by Carol's Stability deposit withdrawal
      assert.equal(whale_Debt_Before, whale_Debt_After)
      assert.equal(alice_Debt_Before, alice_Debt_After)
      assert.equal(bob_Debt_Before, bob_Debt_After)
      assert.equal(carol_Debt_Before, carol_Debt_After)

      assert.equal(whale_Coll_Before, whale_Coll_After)
      assert.equal(alice_Coll_Before, alice_Coll_After)
      assert.equal(bob_Coll_Before, bob_Coll_After)
      assert.equal(carol_Coll_Before, carol_Coll_After)

      assert.equal(whale_ICR_Before, whale_ICR_After)
      assert.equal(alice_ICR_Before, alice_ICR_After)
      assert.equal(bob_ICR_Before, bob_ICR_After)
      assert.equal(carol_ICR_Before, carol_ICR_After)

      assert.equal(whale_Debt_BeforeERC20, whale_Debt_AfterERC20)
      assert.equal(alice_Debt_BeforeERC20, alice_Debt_AfterERC20)
      assert.equal(bob_Debt_BeforeERC20, bob_Debt_AfterERC20)
      assert.equal(carol_Debt_BeforeERC20, carol_Debt_AfterERC20)

      assert.equal(whale_Coll_BeforeERC20, whale_Coll_AfterERC20)
      assert.equal(alice_Coll_BeforeERC20, alice_Coll_AfterERC20)
      assert.equal(bob_Coll_BeforeERC20, bob_Coll_AfterERC20)
      assert.equal(carol_Coll_BeforeERC20, carol_Coll_AfterERC20)

      assert.equal(whale_ICR_BeforeERC20, whale_ICR_AfterERC20)
      assert.equal(alice_ICR_BeforeERC20, alice_ICR_AfterERC20)
      assert.equal(bob_ICR_BeforeERC20, bob_ICR_AfterERC20)
      assert.equal(carol_ICR_BeforeERC20, carol_ICR_AfterERC20)
    })

    it('withdrawFromSP(): succeeds when amount is 0 and system has an undercollateralized trove', async () => {
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

      await stabilityPool.provideToSP(dec(100, 18), { from: A })
      await stabilityPoolERC20.provideToSP(dec(100, 18), { from: A })

      const A_initialDeposit = (await stabilityPool.deposits(A)).toString()
      assert.equal(A_initialDeposit, dec(100, 18))

      const A_initialDepositERC20 = (await stabilityPoolERC20.deposits(A)).toString()
      assert.equal(A_initialDepositERC20, dec(100, 18))

      // defaulters opens trove
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_2 } })

      await openTrove({
        asset: erc20.address,
        ICR: toBN(dec(2, 18)),
        extraParams: { from: defaulter_1 },
      })
      await openTrove({
        asset: erc20.address,
        ICR: toBN(dec(2, 18)),
        extraParams: { from: defaulter_2 },
      })

      // ETH drops, defaulters are in liquidation range
      await priceFeed.setPrice(dec(105, 18))
      const price = await priceFeed.getPrice()
      assert.isTrue(await th.ICRbetween100and110(defaulter_1, troveManagerHelpers, price))
      assert.isTrue(await th.ICRbetween100and110(defaulter_1, troveManagerHelpers, price, erc20.address))

      await th.fastForwardTime(timeValues.MINUTES_IN_ONE_WEEK, web3.currentProvider)

      // Liquidate d1
      await troveManager.liquidate(ZERO_ADDRESS, defaulter_1)
      assert.isFalse(await sortedTroves.contains(ZERO_ADDRESS, defaulter_1))

      await troveManager.liquidate(erc20.address, defaulter_1)
      assert.isFalse(await sortedTroves.contains(erc20.address, defaulter_1))

      // Check d2 is undercollateralized
      assert.isTrue(await th.ICRbetween100and110(defaulter_2, troveManagerHelpers, price))
      assert.isTrue(await sortedTroves.contains(ZERO_ADDRESS, defaulter_2))

      assert.isTrue(await th.ICRbetween100and110(defaulter_2, troveManagerHelpers, price, erc20.address))
      assert.isTrue(await sortedTroves.contains(erc20.address, defaulter_2))

      const A_ETHBalBefore = toBN(await web3.eth.getBalance(A))
      const A_ETHBalBeforeERC20 = toBN(await erc20.balanceOf(A))
      const A_MONBalBefore = await monToken.balanceOf(A)

      // Check Alice has gains to withdraw
      const A_pendingETHGain = await stabilityPool.getDepositorAssetGain(A)
      const A_pendingMONGain = await stabilityPool.getDepositorMONGain(A)
      assert.isTrue(A_pendingETHGain.gt(toBN('0')))
      assert.isTrue(A_pendingMONGain.gt(toBN('0')))

      const A_pendingETHGainERC20 = await stabilityPoolERC20.getDepositorAssetGain(A)
      const A_pendingMONGainERC20 = await stabilityPoolERC20.getDepositorMONGain(A)
      assert.isTrue(A_pendingETHGainERC20.gt(toBN('0')))
      assert.isTrue(A_pendingMONGainERC20.gt(toBN('0')))

      // Check withdrawal of 0 succeeds
      const tx = await stabilityPool.withdrawFromSP(0, { from: A, gasPrice: 0 })
      assert.isTrue(tx.receipt.status)

      const txERC20 = await stabilityPoolERC20.withdrawFromSP(0, { from: A, gasPrice: 0 })
      assert.isTrue(txERC20.receipt.status)

      const A_ETHBalAfter = toBN(await web3.eth.getBalance(A))
      const A_ETHBalAfterERC20 = toBN(await erc20.balanceOf(A))

      const A_MONBalAfter = await monToken.balanceOf(A)
      const A_MONBalDiff = A_MONBalAfter.sub(A_MONBalBefore)

      // Check A's ETH and MON balances have increased correctly
      assert.isTrue(A_ETHBalAfter.sub(A_ETHBalBefore).eq(A_pendingETHGain))
      assert.isTrue(A_ETHBalAfterERC20.sub(A_ETHBalBeforeERC20).eq(A_pendingETHGainERC20))
      assert.isAtMost(th.getDifference(A_MONBalDiff, A_pendingMONGain.add(A_pendingMONGainERC20)), 1000)
    })

    it("withdrawFromSP(): withdrawing 0 DCHF doesn't alter the caller's deposit or the total DCHF in the Stability Pool", async () => {
      // --- SETUP ---
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

      // A, B, C open troves and make Stability Pool deposits
      await openTrove({
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: alice },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(20000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: bob },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(30000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: carol },
      })

      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: alice },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(20000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: bob },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(30000, 18)),
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

      // Bob withdraws 0 DCHF from the Stability Pool
      await stabilityPool.withdrawFromSP(0, { from: bob })
      await stabilityPoolERC20.withdrawFromSP(0, { from: bob })

      // check Bob's deposit and total DCHF in Stability Pool has not changed
      const bob_Deposit_After = (await stabilityPool.getCompoundedDCHFDeposit(bob)).toString()
      const DCHFinSP_After = (await stabilityPool.getTotalDCHFDeposits()).toString()

      const bob_Deposit_AfterERC20 = (await stabilityPoolERC20.getCompoundedDCHFDeposit(bob)).toString()
      const DCHFinSP_AfterERC20 = (await stabilityPoolERC20.getTotalDCHFDeposits()).toString()

      assert.equal(bob_Deposit_Before, bob_Deposit_After)
      assert.equal(DCHFinSP_Before, DCHFinSP_After)

      assert.equal(bob_Deposit_BeforeERC20, bob_Deposit_AfterERC20)
      assert.equal(DCHFinSP_BeforeERC20, DCHFinSP_AfterERC20)
    })

    it("withdrawFromSP(): withdrawing 0 ETH Gain does not alter the caller's ETH balance, their trove collateral, or the ETH  in the Stability Pool", async () => {
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

      // A, B, C open troves and make Stability Pool deposits
      await openTrove({
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: alice },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(20000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: bob },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(30000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: carol },
      })

      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: alice },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(20000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: bob },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(30000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: carol },
      })

      // Would-be defaulter open trove
      await openTrove({
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: defaulter_1 },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: defaulter_1 },
      })

      // Price drops
      await priceFeed.setPrice(dec(105, 18))

      assert.isFalse(await th.checkRecoveryMode(contracts))
      assert.isFalse(await th.checkRecoveryMode(contracts, erc20.address))

      // Defaulter 1 liquidated, full offset
      await troveManager.liquidate(ZERO_ADDRESS, defaulter_1)
      await troveManager.liquidate(erc20.address, defaulter_1)

      // Dennis opens trove and deposits to Stability Pool
      await openTrove({
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: dennis },
      })
      await stabilityPool.provideToSP(dec(100, 18), { from: dennis })

      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: dennis },
      })
      await stabilityPoolERC20.provideToSP(dec(100, 18), { from: dennis })

      // Check Dennis has 0 AssetGain
      const dennis_ETHGain = (await stabilityPool.getDepositorAssetGain(dennis)).toString()
      assert.equal(dennis_ETHGain, '0')

      const dennis_ETHGainERC20 = (await stabilityPoolERC20.getDepositorAssetGain(dennis)).toString()
      assert.equal(dennis_ETHGainERC20, '0')

      const dennis_ETHBalance_Before = web3.eth.getBalance(dennis).toString()
      const dennis_Collateral_Before = (await troveManagerHelpers.Troves(dennis, ZERO_ADDRESS))[
        th.TROVE_COLL_INDEX
      ].toString()
      const ETHinSP_Before = (await stabilityPool.getAssetBalance()).toString()

      const dennis_ETHBalance_BeforeERC20 = (await erc20.balanceOf(dennis)).toString()
      const dennis_Collateral_BeforeERC20 = (await troveManagerHelpers.Troves(dennis, erc20.address))[
        th.TROVE_COLL_INDEX
      ].toString()
      const ETHinSP_BeforeERC20 = (await stabilityPoolERC20.getAssetBalance()).toString()

      await priceFeed.setPrice(dec(200, 18))

      // Dennis withdraws his full deposit and AssetGain to his account
      await stabilityPool.withdrawFromSP(dec(100, 18), { from: dennis, gasPrice: 0 })
      await stabilityPoolERC20.withdrawFromSP(dec(100, 18), { from: dennis, gasPrice: 0 })

      // Check withdrawal does not alter Dennis' ETH balance or his trove's collateral
      const dennis_ETHBalance_After = web3.eth.getBalance(dennis).toString()
      const dennis_Collateral_After = (await troveManagerHelpers.Troves(dennis, ZERO_ADDRESS))[
        th.TROVE_COLL_INDEX
      ].toString()
      const ETHinSP_After = (await stabilityPool.getAssetBalance()).toString()

      const dennis_ETHBalance_AfterERC20 = (await erc20.balanceOf(dennis)).toString()
      const dennis_Collateral_AfterERC20 = (await troveManagerHelpers.Troves(dennis, erc20.address))[
        th.TROVE_COLL_INDEX
      ].toString()
      const ETHinSP_AfterERC20 = (await stabilityPoolERC20.getAssetBalance()).toString()

      assert.equal(dennis_ETHBalance_Before, dennis_ETHBalance_After)
      assert.equal(dennis_Collateral_Before, dennis_Collateral_After)
      assert.equal(dennis_ETHBalance_BeforeERC20, dennis_ETHBalance_AfterERC20)
      assert.equal(dennis_Collateral_BeforeERC20, dennis_Collateral_AfterERC20)

      // Check withdrawal has not altered the ETH in the Stability Pool
      assert.equal(ETHinSP_Before, ETHinSP_After)
      assert.equal(ETHinSP_BeforeERC20, ETHinSP_AfterERC20)
    })

    it("withdrawFromSP(): Request to withdraw > caller's deposit only withdraws the caller's compounded deposit", async () => {
      // --- SETUP ---
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

      // A, B, C open troves and make Stability Pool deposits
      await openTrove({
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: alice },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(20000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: bob },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(30000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: carol },
      })

      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: alice },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(20000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: bob },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(30000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: carol },
      })

      await openTrove({
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: defaulter_1 },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: defaulter_1 },
      })

      // A, B, C provide DCHF to SP
      await stabilityPool.provideToSP(dec(10000, 18), { from: alice })
      await stabilityPool.provideToSP(dec(20000, 18), { from: bob })
      await stabilityPool.provideToSP(dec(30000, 18), { from: carol })

      await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: alice })
      await stabilityPoolERC20.provideToSP(dec(20000, 18), { from: bob })
      await stabilityPoolERC20.provideToSP(dec(30000, 18), { from: carol })

      // Price drops
      await priceFeed.setPrice(dec(105, 18))

      // Liquidate defaulter 1
      await troveManager.liquidate(ZERO_ADDRESS, defaulter_1)
      await troveManager.liquidate(erc20.address, defaulter_1)

      const alice_DCHF_Balance_Before = await dchfToken.balanceOf(alice)
      const bob_DCHF_Balance_Before = await dchfToken.balanceOf(bob)

      const alice_Deposit_Before = await stabilityPool.getCompoundedDCHFDeposit(alice)
      const bob_Deposit_Before = await stabilityPool.getCompoundedDCHFDeposit(bob)

      const alice_Deposit_BeforeERC20 = await stabilityPoolERC20.getCompoundedDCHFDeposit(alice)
      const bob_Deposit_BeforeERC20 = await stabilityPoolERC20.getCompoundedDCHFDeposit(bob)

      const DCHFinSP_Before = await stabilityPool.getTotalDCHFDeposits()
      const DCHFinSP_BeforeERC20 = await stabilityPoolERC20.getTotalDCHFDeposits()

      await priceFeed.setPrice(dec(200, 18))

      // Bob attempts to withdraws 1 wei more than his compounded deposit from the Stability Pool
      await stabilityPool.withdrawFromSP(bob_Deposit_Before.add(toBN(1)), { from: bob })
      await stabilityPoolERC20.withdrawFromSP(bob_Deposit_BeforeERC20.add(toBN(1)), {
        from: bob,
      })

      // Check Bob's DCHF balance has risen by only the value of his compounded deposit
      const bob_expectedDCHFBalance = bob_DCHF_Balance_Before
        .add(bob_Deposit_Before)
        .add(bob_Deposit_BeforeERC20)
        .toString()
      const bob_DCHF_Balance_After = (await dchfToken.balanceOf(bob)).toString()
      assert.equal(bob_DCHF_Balance_After, bob_expectedDCHFBalance)

      // Alice attempts to withdraws 2309842309.000000000000000000 DCHF from the Stability Pool
      await stabilityPool.withdrawFromSP('2309842309000000000000000000', { from: alice })
      await stabilityPoolERC20.withdrawFromSP('2309842309000000000000000000', { from: alice })

      // Check Alice's DCHF balance has risen by only the value of her compounded deposit
      const alice_expectedDCHFBalance = alice_DCHF_Balance_Before
        .add(alice_Deposit_Before)
        .add(alice_Deposit_BeforeERC20)
        .toString()
      const alice_DCHF_Balance_After = (await dchfToken.balanceOf(alice)).toString()
      assert.equal(alice_DCHF_Balance_After, alice_expectedDCHFBalance)

      // Check DCHF in Stability Pool has been reduced by only Alice's compounded deposit and Bob's compounded deposit
      const expectedDCHFinSP = DCHFinSP_Before.sub(alice_Deposit_Before).sub(bob_Deposit_Before).toString()
      const DCHFinSP_After = (await stabilityPool.getTotalDCHFDeposits()).toString()
      assert.equal(DCHFinSP_After, expectedDCHFinSP)
    })

    it("withdrawFromSP(): Request to withdraw 2^256-1 DCHF only withdraws the caller's compounded deposit", async () => {
      // --- SETUP ---
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
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: alice },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(20000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: bob },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(30000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: carol },
      })

      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: alice },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(20000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: bob },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(30000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: carol },
      })

      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })
      await openTrove({
        asset: erc20.address,
        ICR: toBN(dec(2, 18)),
        extraParams: { from: defaulter_1 },
      })

      // A, B, C provides 100, 50, 30 DCHF to SP
      await stabilityPool.provideToSP(dec(100, 18), { from: alice })
      await stabilityPool.provideToSP(dec(50, 18), { from: bob })
      await stabilityPool.provideToSP(dec(30, 18), { from: carol })

      await stabilityPoolERC20.provideToSP(dec(100, 18), { from: alice })
      await stabilityPoolERC20.provideToSP(dec(50, 18), { from: bob })
      await stabilityPoolERC20.provideToSP(dec(30, 18), { from: carol })

      // Price drops
      await priceFeed.setPrice(dec(100, 18))

      // Liquidate defaulter 1
      await troveManager.liquidate(ZERO_ADDRESS, defaulter_1)
      await troveManager.liquidate(erc20.address, defaulter_1)

      const bob_DCHF_Balance_Before = await dchfToken.balanceOf(bob)

      const bob_Deposit_Before = await stabilityPool.getCompoundedDCHFDeposit(bob)
      const bob_Deposit_BeforeERC20 = await stabilityPoolERC20.getCompoundedDCHFDeposit(bob)

      const DCHFinSP_Before = await stabilityPool.getTotalDCHFDeposits()
      const DCHFinSP_BeforeERC20 = await stabilityPoolERC20.getTotalDCHFDeposits()

      const maxBytes32 = web3.utils.toBN('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')

      // Price drops
      await priceFeed.setPrice(dec(200, 18))

      // Bob attempts to withdraws maxBytes32 DCHF from the Stability Pool
      await stabilityPool.withdrawFromSP(maxBytes32, { from: bob })
      await stabilityPoolERC20.withdrawFromSP(maxBytes32, { from: bob })

      // Check Bob's DCHF balance has risen by only the value of his compounded deposit
      const bob_expectedDCHFBalance = bob_DCHF_Balance_Before
        .add(bob_Deposit_Before)
        .add(bob_Deposit_BeforeERC20)
        .toString()
      const bob_DCHF_Balance_After = (await dchfToken.balanceOf(bob)).toString()
      assert.equal(bob_DCHF_Balance_After, bob_expectedDCHFBalance)

      // Check DCHF in Stability Pool has been reduced by only  Bob's compounded deposit
      const expectedDCHFinSP = DCHFinSP_Before.sub(bob_Deposit_Before).toString()
      const DCHFinSP_After = (await stabilityPool.getTotalDCHFDeposits()).toString()
      assert.equal(DCHFinSP_After, expectedDCHFinSP)

      const expectedDCHFinSPERC20 = DCHFinSP_BeforeERC20.sub(bob_Deposit_BeforeERC20).toString()
      const DCHFinSP_AfterERC20 = (await stabilityPoolERC20.getTotalDCHFDeposits()).toString()
      assert.equal(DCHFinSP_AfterERC20, expectedDCHFinSPERC20)
    })

    it('withdrawFromSP(): caller can withdraw full deposit and ETH gain during Recovery Mode', async () => {
      // --- SETUP ---

      // Price doubles
      await priceFeed.setPrice(dec(400, 18))
      await openTrove({
        extraDCHFAmount: toBN(dec(1000000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: whale },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(1000000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: whale },
      })
      // Price halves
      await priceFeed.setPrice(dec(200, 18))

      // A, B, C open troves and make Stability Pool deposits
      await openTrove({
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(4, 18)),
        extraParams: { from: alice },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(20000, 18)),
        ICR: toBN(dec(4, 18)),
        extraParams: { from: bob },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(30000, 18)),
        ICR: toBN(dec(4, 18)),
        extraParams: { from: carol },
      })

      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(4, 18)),
        extraParams: { from: alice },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(20000, 18)),
        ICR: toBN(dec(4, 18)),
        extraParams: { from: bob },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(30000, 18)),
        ICR: toBN(dec(4, 18)),
        extraParams: { from: carol },
      })

      await borrowerOperations.openTrove(
        ZERO_ADDRESS,
        0,
        th._100pct,
        await getOpenTroveDCHFAmount(dec(10000, 18), ZERO_ADDRESS),
        defaulter_1,
        defaulter_1,
        { from: defaulter_1, value: dec(100, 'ether') }
      )
      await borrowerOperations.openTrove(
        erc20.address,
        dec(100, 'ether'),
        th._100pct,
        await getOpenTroveDCHFAmount(dec(10000, 18), ZERO_ADDRESS),
        defaulter_1,
        defaulter_1,
        { from: defaulter_1 }
      )

      // A, B, C provides 10000, 5000, 3000 DCHF to SP
      await stabilityPool.provideToSP(dec(10000, 18), { from: alice })
      await stabilityPool.provideToSP(dec(5000, 18), { from: bob })
      await stabilityPool.provideToSP(dec(3000, 18), { from: carol })

      await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: alice })
      await stabilityPoolERC20.provideToSP(dec(5000, 18), { from: bob })
      await stabilityPoolERC20.provideToSP(dec(3000, 18), { from: carol })

      // Price drops
      await priceFeed.setPrice(dec(105, 18))
      const price = await priceFeed.getPrice()

      assert.isTrue(await th.checkRecoveryMode(contracts))
      assert.isTrue(await th.checkRecoveryMode(contracts, erc20.address))

      // Liquidate defaulter 1
      await troveManager.liquidate(ZERO_ADDRESS, defaulter_1)
      await troveManager.liquidate(erc20.address, defaulter_1)
      assert.isFalse(await sortedTroves.contains(ZERO_ADDRESS, defaulter_1))
      assert.isFalse(await sortedTroves.contains(erc20.address, defaulter_1))

      const alice_DCHF_Balance_Before = await dchfToken.balanceOf(alice)
      const bob_DCHF_Balance_Before = await dchfToken.balanceOf(bob)
      const carol_DCHF_Balance_Before = await dchfToken.balanceOf(carol)

      const alice_ETH_Balance_Before = web3.utils.toBN(await web3.eth.getBalance(alice))
      const bob_ETH_Balance_Before = web3.utils.toBN(await web3.eth.getBalance(bob))
      const carol_ETH_Balance_Before = web3.utils.toBN(await web3.eth.getBalance(carol))

      const alice_ETH_Balance_BeforeERC20 = web3.utils.toBN(await erc20.balanceOf(alice))
      const bob_ETH_Balance_BeforeERC20 = web3.utils.toBN(await erc20.balanceOf(bob))
      const carol_ETH_Balance_BeforeERC20 = web3.utils.toBN(await erc20.balanceOf(carol))

      const alice_Deposit_Before = await stabilityPool.getCompoundedDCHFDeposit(alice)
      const bob_Deposit_Before = await stabilityPool.getCompoundedDCHFDeposit(bob)
      const carol_Deposit_Before = await stabilityPool.getCompoundedDCHFDeposit(carol)

      const alice_Deposit_BeforeERC20 = await stabilityPoolERC20.getCompoundedDCHFDeposit(alice)
      const bob_Deposit_BeforeERC20 = await stabilityPoolERC20.getCompoundedDCHFDeposit(bob)
      const carol_Deposit_BeforeERC20 = await stabilityPoolERC20.getCompoundedDCHFDeposit(carol)

      const alice_ETHGain_Before = await stabilityPool.getDepositorAssetGain(alice)
      const bob_ETHGain_Before = await stabilityPool.getDepositorAssetGain(bob)
      const carol_ETHGain_Before = await stabilityPool.getDepositorAssetGain(carol)

      const alice_ETHGain_BeforeERC20 = await stabilityPoolERC20.getDepositorAssetGain(alice)
      const bob_ETHGain_BeforeERC20 = await stabilityPoolERC20.getDepositorAssetGain(bob)
      const carol_ETHGain_BeforeERC20 = await stabilityPoolERC20.getDepositorAssetGain(carol)

      const DCHFinSP_Before = await stabilityPool.getTotalDCHFDeposits()
      const DCHFinSP_BeforeERC20 = await stabilityPoolERC20.getTotalDCHFDeposits()

      // Price rises
      await priceFeed.setPrice(dec(220, 18))

      assert.isTrue(await th.checkRecoveryMode(contracts))
      assert.isTrue(await th.checkRecoveryMode(contracts, erc20.address))

      // A, B, C withdraw their full deposits from the Stability Pool
      await stabilityPool.withdrawFromSP(dec(10000, 18), { from: alice, gasPrice: 0 })
      await stabilityPool.withdrawFromSP(dec(5000, 18), { from: bob, gasPrice: 0 })
      await stabilityPool.withdrawFromSP(dec(3000, 18), { from: carol, gasPrice: 0 })

      await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), { from: alice, gasPrice: 0 })
      await stabilityPoolERC20.withdrawFromSP(dec(5000, 18), { from: bob, gasPrice: 0 })
      await stabilityPoolERC20.withdrawFromSP(dec(3000, 18), { from: carol, gasPrice: 0 })

      // Check DCHF balances of A, B, C have risen by the value of their compounded deposits, respectively
      const alice_expectedDCHFBalance = alice_DCHF_Balance_Before
        .add(alice_Deposit_Before)
        .add(alice_Deposit_BeforeERC20)
        .toString()
      const bob_expectedDCHFBalance = bob_DCHF_Balance_Before
        .add(bob_Deposit_Before)
        .add(bob_Deposit_BeforeERC20)
        .toString()
      const carol_expectedDCHFBalance = carol_DCHF_Balance_Before
        .add(carol_Deposit_Before)
        .add(carol_Deposit_BeforeERC20)
        .toString()

      const alice_DCHF_Balance_After = (await dchfToken.balanceOf(alice)).toString()
      const bob_DCHF_Balance_After = (await dchfToken.balanceOf(bob)).toString()
      const carol_DCHF_Balance_After = (await dchfToken.balanceOf(carol)).toString()

      assert.equal(alice_DCHF_Balance_After, alice_expectedDCHFBalance)
      assert.equal(bob_DCHF_Balance_After, bob_expectedDCHFBalance)
      assert.equal(carol_DCHF_Balance_After, carol_expectedDCHFBalance)

      // Check ETH balances of A, B, C have increased by the value of their ETH gain from liquidations, respectively
      const alice_expectedETHBalance = alice_ETH_Balance_Before.add(alice_ETHGain_Before).toString()
      const bob_expectedETHBalance = bob_ETH_Balance_Before.add(bob_ETHGain_Before).toString()
      const carol_expectedETHBalance = carol_ETH_Balance_Before.add(carol_ETHGain_Before).toString()

      const alice_expectedETHBalanceERC20 = alice_ETH_Balance_BeforeERC20
        .add(alice_ETHGain_BeforeERC20)
        .toString()
      const bob_expectedETHBalanceERC20 = bob_ETH_Balance_BeforeERC20.add(bob_ETHGain_BeforeERC20).toString()
      const carol_expectedETHBalanceERC20 = carol_ETH_Balance_BeforeERC20
        .add(carol_ETHGain_BeforeERC20)
        .toString()

      const alice_ETHBalance_After = (await web3.eth.getBalance(alice)).toString()
      const bob_ETHBalance_After = (await web3.eth.getBalance(bob)).toString()
      const carol_ETHBalance_After = (await web3.eth.getBalance(carol)).toString()

      const alice_ETHBalance_AfterERC20 = (await erc20.balanceOf(alice)).toString()
      const bob_ETHBalance_AfterERC20 = (await erc20.balanceOf(bob)).toString()
      const carol_ETHBalance_AfterERC20 = (await erc20.balanceOf(carol)).toString()

      assert.equal(alice_expectedETHBalance, alice_ETHBalance_After)
      assert.equal(bob_expectedETHBalance, bob_ETHBalance_After)
      assert.equal(carol_expectedETHBalance, carol_ETHBalance_After)

      assert.equal(alice_expectedETHBalanceERC20, alice_ETHBalance_AfterERC20)
      assert.equal(bob_expectedETHBalanceERC20, bob_ETHBalance_AfterERC20)
      assert.equal(carol_expectedETHBalanceERC20, carol_ETHBalance_AfterERC20)

      // Check DCHF in Stability Pool has been reduced by A, B and C's compounded deposit
      const expectedDCHFinSP = DCHFinSP_Before.sub(alice_Deposit_Before)
        .sub(bob_Deposit_Before)
        .sub(carol_Deposit_Before)
        .toString()
      const DCHFinSP_After = (await stabilityPool.getTotalDCHFDeposits()).toString()
      assert.equal(DCHFinSP_After, expectedDCHFinSP)

      const expectedDCHFinSPERC20 = DCHFinSP_BeforeERC20.sub(alice_Deposit_BeforeERC20)
        .sub(bob_Deposit_BeforeERC20)
        .sub(carol_Deposit_BeforeERC20)
        .toString()
      const DCHFinSP_AfterERC20 = (await stabilityPoolERC20.getTotalDCHFDeposits()).toString()
      assert.equal(DCHFinSP_AfterERC20, expectedDCHFinSPERC20)

      // Check ETH in SP has reduced to zero
      const ETHinSP_After = (await stabilityPool.getAssetBalance()).toString()
      assert.isAtMost(th.getDifference(ETHinSP_After, '0'), 100000)

      const ETHinSP_AfterERC20 = (await stabilityPoolERC20.getAssetBalance()).toString()
      assert.isAtMost(th.getDifference(ETHinSP_AfterERC20, '0'), 100000)
    })

    it('getDepositorETHGain(): depositor does not earn further ETH gains from liquidations while their compounded deposit == 0: ', async () => {
      await openTrove({
        extraDCHFAmount: toBN(dec(1, 24)),
        ICR: toBN(dec(10, 18)),
        extraParams: { from: whale },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(1, 24)),
        ICR: toBN(dec(10, 18)),
        extraParams: { from: whale },
      })

      // A, B, C open troves
      await openTrove({
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: alice },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(20000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: bob },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(30000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: carol },
      })

      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: alice },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(20000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: bob },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(30000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: carol },
      })

      // defaulters open troves
      await openTrove({
        extraDCHFAmount: toBN(dec(15000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: defaulter_1 },
      })
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_2 } })
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_3 } })

      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(15000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: defaulter_1 },
      })
      await openTrove({
        asset: erc20.address,
        ICR: toBN(dec(2, 18)),
        extraParams: { from: defaulter_2 },
      })
      await openTrove({
        asset: erc20.address,
        ICR: toBN(dec(2, 18)),
        extraParams: { from: defaulter_3 },
      })

      // A, B, provide 10000, 5000 DCHF to SP
      await stabilityPool.provideToSP(dec(10000, 18), { from: alice })
      await stabilityPool.provideToSP(dec(5000, 18), { from: bob })

      await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: alice })
      await stabilityPoolERC20.provideToSP(dec(5000, 18), { from: bob })

      //price drops
      await priceFeed.setPrice(dec(105, 18))

      // Liquidate defaulter 1. Empties the Pool
      await troveManager.liquidate(ZERO_ADDRESS, defaulter_1)
      assert.isFalse(await sortedTroves.contains(ZERO_ADDRESS, defaulter_1))

      await troveManager.liquidate(erc20.address, defaulter_1)
      assert.isFalse(await sortedTroves.contains(erc20.address, defaulter_1))

      const DCHFinSP = (await stabilityPool.getTotalDCHFDeposits()).toString()
      assert.equal(DCHFinSP, '0')

      const DCHFinSPERC20 = (await stabilityPoolERC20.getTotalDCHFDeposits()).toString()
      assert.equal(DCHFinSPERC20, '0')

      // Check Stability deposits have been fully cancelled with debt, and are now all zero
      const alice_Deposit = (await stabilityPool.getCompoundedDCHFDeposit(alice)).toString()
      const bob_Deposit = (await stabilityPool.getCompoundedDCHFDeposit(bob)).toString()

      const alice_DepositERC20 = (await stabilityPoolERC20.getCompoundedDCHFDeposit(alice)).toString()
      const bob_DepositERC20 = (await stabilityPoolERC20.getCompoundedDCHFDeposit(bob)).toString()

      assert.equal(alice_Deposit, '0')
      assert.equal(bob_Deposit, '0')
      assert.equal(alice_DepositERC20, '0')
      assert.equal(bob_DepositERC20, '0')

      // Get ETH gain for A and B
      const alice_ETHGain_1 = (await stabilityPool.getDepositorAssetGain(alice)).toString()
      const bob_ETHGain_1 = (await stabilityPool.getDepositorAssetGain(bob)).toString()

      const alice_ETHGain_1ERC20 = (await stabilityPoolERC20.getDepositorAssetGain(alice)).toString()
      const bob_ETHGain_1ERC20 = (await stabilityPoolERC20.getDepositorAssetGain(bob)).toString()

      // Whale deposits 10000 DCHF to Stability Pool
      await stabilityPool.provideToSP(dec(1, 24), { from: whale })
      await stabilityPoolERC20.provideToSP(dec(1, 24), { from: whale })

      // Liquidation 2
      await troveManager.liquidate(ZERO_ADDRESS, defaulter_2)
      assert.isFalse(await sortedTroves.contains(ZERO_ADDRESS, defaulter_2))

      await troveManager.liquidate(erc20.address, defaulter_2)
      assert.isFalse(await sortedTroves.contains(erc20.address, defaulter_2))

      // Check Alice and Bob have not received ETH gain from liquidation 2 while their deposit was 0
      const alice_ETHGain_2 = (await stabilityPool.getDepositorAssetGain(alice)).toString()
      const bob_ETHGain_2 = (await stabilityPool.getDepositorAssetGain(bob)).toString()

      const alice_ETHGain_2ERC20 = (await stabilityPoolERC20.getDepositorAssetGain(alice)).toString()
      const bob_ETHGain_2ERC20 = (await stabilityPoolERC20.getDepositorAssetGain(bob)).toString()

      assert.equal(alice_ETHGain_1, alice_ETHGain_2)
      assert.equal(bob_ETHGain_1, bob_ETHGain_2)

      assert.equal(alice_ETHGain_1ERC20, alice_ETHGain_2ERC20)
      assert.equal(bob_ETHGain_1ERC20, bob_ETHGain_2ERC20)

      // Liquidation 3
      await troveManager.liquidate(ZERO_ADDRESS, defaulter_3)
      assert.isFalse(await sortedTroves.contains(ZERO_ADDRESS, defaulter_3))

      await troveManager.liquidate(erc20.address, defaulter_3)
      assert.isFalse(await sortedTroves.contains(erc20.address, defaulter_3))

      // Check Alice and Bob have not received ETH gain from liquidation 3 while their deposit was 0
      const alice_ETHGain_3 = (await stabilityPool.getDepositorAssetGain(alice)).toString()
      const bob_ETHGain_3 = (await stabilityPool.getDepositorAssetGain(bob)).toString()

      const alice_ETHGain_3ERC20 = (await stabilityPoolERC20.getDepositorAssetGain(alice)).toString()
      const bob_ETHGain_3ERC20 = (await stabilityPoolERC20.getDepositorAssetGain(bob)).toString()

      assert.equal(alice_ETHGain_1, alice_ETHGain_3)
      assert.equal(bob_ETHGain_1, bob_ETHGain_3)

      assert.equal(alice_ETHGain_1ERC20, alice_ETHGain_3ERC20)
      assert.equal(bob_ETHGain_1ERC20, bob_ETHGain_3ERC20)
    })

    // --- MON functionality ---
    it('withdrawFromSP(): triggers MON reward event - increases the sum G', async () => {
      await openTrove({
        extraDCHFAmount: toBN(dec(1, 24)),
        ICR: toBN(dec(10, 18)),
        extraParams: { from: whale },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(1, 24)),
        ICR: toBN(dec(10, 18)),
        extraParams: { from: whale },
      })

      // A, B, C open troves
      await openTrove({
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: A },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(20000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: B },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(30000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: C },
      })

      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: A },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(20000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: B },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(30000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: C },
      })

      // A and B provide to SP
      await stabilityPool.provideToSP(dec(10000, 18), { from: A })
      await stabilityPool.provideToSP(dec(10000, 18), { from: B })

      await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: A })
      await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: B })

      const G_Before = await stabilityPool.epochToScaleToG(0, 0)
      const G_BeforeERC20 = await stabilityPoolERC20.epochToScaleToG(0, 0)

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

      // A withdraws from SP
      await stabilityPool.withdrawFromSP(dec(5000, 18), { from: A })
      await stabilityPoolERC20.withdrawFromSP(dec(5000, 18), { from: A })

      const G_1 = await stabilityPool.epochToScaleToG(0, 0)
      const G_1ERC20 = await stabilityPoolERC20.epochToScaleToG(0, 0)

      // Expect G has increased from the MON reward event triggered
      assert.isTrue(G_1.gt(G_Before))
      assert.isTrue(G_1ERC20.gt(G_BeforeERC20))

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

      // A withdraws from SP
      await stabilityPool.withdrawFromSP(dec(5000, 18), { from: B })
      await stabilityPoolERC20.withdrawFromSP(dec(5000, 18), { from: B })

      const G_2 = await stabilityPool.epochToScaleToG(0, 0)
      const G_2ERC20 = await stabilityPoolERC20.epochToScaleToG(0, 0)

      // Expect G has increased from the MON reward event triggered
      assert.isTrue(G_2.gt(G_1))
      assert.isTrue(G_2ERC20.gt(G_1ERC20))
    })

    it('withdrawFromSP(), partial withdrawal: depositor receives MON rewards', async () => {
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
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: A },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(20000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: B },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(30000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: C },
      })

      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: A },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(20000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: B },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(30000, 18)),
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

      // A, B, C withdraw
      await stabilityPool.withdrawFromSP(dec(1, 18), { from: A })
      await stabilityPool.withdrawFromSP(dec(2, 18), { from: B })
      await stabilityPool.withdrawFromSP(dec(3, 18), { from: C })

      await stabilityPoolERC20.withdrawFromSP(dec(1, 18), { from: A })
      await stabilityPoolERC20.withdrawFromSP(dec(2, 18), { from: B })
      await stabilityPoolERC20.withdrawFromSP(dec(3, 18), { from: C })

      // Get MON balance after
      const A_MONBalance_After = await monToken.balanceOf(A)
      const B_MONBalance_After = await monToken.balanceOf(B)
      const C_MONBalance_After = await monToken.balanceOf(C)

      // Check MON Balance of A, B, C has increased
      assert.isTrue(A_MONBalance_After.gt(A_MONBalance_Before))
      assert.isTrue(B_MONBalance_After.gt(B_MONBalance_Before))
      assert.isTrue(C_MONBalance_After.gt(C_MONBalance_Before))
    })

    it("withdrawFromSP(), partial withdrawal: System's stake decreases", async () => {
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

      // A, B, C, D, E, F open troves
      await openTrove({
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: A },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(20000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: B },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(30000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: C },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: D },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(20000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: E },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(30000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: F },
      })

      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: A },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(20000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: B },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(30000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: C },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: D },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(20000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: E },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(30000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: F },
      })

      // A, B, C, D, E, F provide to SP
      await stabilityPool.provideToSP(dec(10, 18), { from: A })
      await stabilityPool.provideToSP(dec(20, 18), { from: B })
      await stabilityPool.provideToSP(dec(30, 18), { from: C })
      await stabilityPool.provideToSP(dec(10, 18), { from: D })
      await stabilityPool.provideToSP(dec(20, 18), { from: E })
      await stabilityPool.provideToSP(dec(30, 18), { from: F })

      await stabilityPoolERC20.provideToSP(dec(10, 18), { from: A })
      await stabilityPoolERC20.provideToSP(dec(20, 18), { from: B })
      await stabilityPoolERC20.provideToSP(dec(30, 18), { from: C })
      await stabilityPoolERC20.provideToSP(dec(10, 18), { from: D })
      await stabilityPoolERC20.provideToSP(dec(20, 18), { from: E })
      await stabilityPoolERC20.provideToSP(dec(30, 18), { from: F })

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

      // Get front ends' stake before
      const Stake_Before = await stabilityPool.totalStakes()
      const Stake_BeforeERC20 = await stabilityPoolERC20.totalStakes()

      // A, B, C withdraw
      await stabilityPool.withdrawFromSP(dec(1, 18), { from: A })
      await stabilityPool.withdrawFromSP(dec(2, 18), { from: B })
      await stabilityPool.withdrawFromSP(dec(3, 18), { from: C })

      await stabilityPoolERC20.withdrawFromSP(dec(1, 18), { from: A })
      await stabilityPoolERC20.withdrawFromSP(dec(2, 18), { from: B })
      await stabilityPoolERC20.withdrawFromSP(dec(3, 18), { from: C })

      // Get front ends' stakes after
      const Stake_After = await stabilityPool.totalStakes()
      const Stake_AfterERC20 = await stabilityPoolERC20.totalStakes()

      // Check front ends' stakes have decreased
      assert.isTrue(Stake_After.lt(Stake_Before))
      assert.isTrue(Stake_AfterERC20.lt(Stake_BeforeERC20))
    })

    it("withdrawFromSP(), partial withdrawal: System's snapshots update", async () => {
      await openTrove({
        extraDCHFAmount: toBN(dec(100000, 18)),
        ICR: toBN(dec(10, 18)),
        extraParams: { from: whale },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(100000, 18)),
        ICR: toBN(dec(10, 18)),
        extraParams: { from: whale },
      })

      // A, B, C, open troves
      await openTrove({
        extraDCHFAmount: toBN(dec(20000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: A },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(40000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: B },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(60000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: C },
      })

      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(20000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: A },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(40000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: B },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(60000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: C },
      })

      // D opens trove
      await openTrove({
        extraDCHFAmount: toBN(dec(100000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: D },
      })
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })

      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(100000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: D },
      })
      await openTrove({
        asset: erc20.address,
        ICR: toBN(dec(2, 18)),
        extraParams: { from: defaulter_1 },
      })

      // --- SETUP ---

      const deposit_A = dec(10000, 18)
      const deposit_B = dec(20000, 18)
      const deposit_C = dec(30000, 18)

      // A, B, C make their initial deposits
      await stabilityPool.provideToSP(deposit_A, { from: A })
      await stabilityPool.provideToSP(deposit_B, { from: B })
      await stabilityPool.provideToSP(deposit_C, { from: C })

      await stabilityPoolERC20.provideToSP(deposit_A, { from: A })
      await stabilityPoolERC20.provideToSP(deposit_B, { from: B })
      await stabilityPoolERC20.provideToSP(deposit_C, { from: C })

      // fastforward time then make an SP deposit, to make G > 0
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

      await stabilityPoolERC20.provideToSP(dec(1000, 18), { from: D })
      await stabilityPoolERC20.provideToSP(dec(1000, 18), { from: D })

      // perform a liquidation to make 0 < P < 1, and S > 0
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

      // --- TEST ---

      await priceFeed.setPrice(dec(200, 18))

      // A, B, C top withdraw part of their deposits. Grab G at each stage, as it can increase a bit
      // between topups, because some block.timestamp time passes (and LQTY is issued) between ops
      const G1 = await stabilityPool.epochToScaleToG(currentScale, currentEpoch)
      await stabilityPool.withdrawFromSP(dec(1, 18), { from: A })

      const G1ERC20 = await stabilityPoolERC20.epochToScaleToG(currentScaleERC20, currentEpochERC20)
      await stabilityPoolERC20.withdrawFromSP(dec(1, 18), { from: A })

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

    it("withdrawFromSP(), full withdrawal: zero's depositor's snapshots", async () => {
      await openTrove({
        extraDCHFAmount: toBN(dec(1000000, 18)),
        ICR: toBN(dec(10, 18)),
        extraParams: { from: whale },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(1000000, 18)),
        ICR: toBN(dec(10, 18)),
        extraParams: { from: whale },
      })

      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })
      await openTrove({
        asset: erc20.address,
        ICR: toBN(dec(2, 18)),
        extraParams: { from: defaulter_1 },
      })

      //  SETUP: Execute a series of operations to make G, S > 0 and P < 1

      // E opens trove and makes a deposit
      await openTrove({
        extraDCHFAmount: toBN(dec(20000, 18)),
        ICR: toBN(dec(10, 18)),
        extraParams: { from: E },
      })
      await stabilityPool.provideToSP(dec(10000, 18), { from: E })

      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(20000, 18)),
        ICR: toBN(dec(10, 18)),
        extraParams: { from: E },
      })
      await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: E })

      // Fast-forward time and make a second deposit, to trigger MON reward and make G > 0
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)
      await stabilityPool.provideToSP(dec(10000, 18), { from: E })
      await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: E })

      // perform a liquidation to make 0 < P < 1, and S > 0
      await priceFeed.setPrice(dec(105, 18))
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

      // Whale transfers to A, B
      await dchfToken.transfer(A, dec(20000, 18), { from: whale })
      await dchfToken.transfer(B, dec(40000, 18), { from: whale })

      await priceFeed.setPrice(dec(200, 18))

      // C, D open troves
      await openTrove({
        extraDCHFAmount: toBN(dec(30000, 18)),
        ICR: toBN(dec(10, 18)),
        extraParams: { from: C },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(40000, 18)),
        ICR: toBN(dec(10, 18)),
        extraParams: { from: D },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(30000, 18)),
        ICR: toBN(dec(10, 18)),
        extraParams: { from: C },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(40000, 18)),
        ICR: toBN(dec(10, 18)),
        extraParams: { from: D },
      })

      // A, B, C, D make their initial deposits
      await stabilityPool.provideToSP(dec(10000, 18), { from: A })
      await stabilityPool.provideToSP(dec(20000, 18), { from: B })
      await stabilityPool.provideToSP(dec(30000, 18), { from: C })
      await stabilityPool.provideToSP(dec(40000, 18), { from: D })

      await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: A })
      await stabilityPoolERC20.provideToSP(dec(20000, 18), { from: B })
      await stabilityPoolERC20.provideToSP(dec(30000, 18), { from: C })
      await stabilityPoolERC20.provideToSP(dec(40000, 18), { from: D })

      // Check deposits snapshots are non-zero

      for (depositor of [A, B, C, D]) {
        const snapshot = await stabilityPool.depositSnapshots(depositor)

        const ZERO = toBN('0')
        // Check S,P, G snapshots are non-zero
        assert.isTrue(snapshot[0].eq(S_Before)) // S
        assert.isTrue(snapshot[1].eq(P_Before)) // P
        assert.isTrue(snapshot[2].gt(ZERO)) // GL increases a bit between each depositor op, so just check it is non-zero
        assert.equal(snapshot[3], '0') // scale
        assert.equal(snapshot[4], '0') // epoch
      }

      for (depositor of [A, B, C, D]) {
        const snapshot = await stabilityPoolERC20.depositSnapshots(depositor)

        const ZERO = toBN('0')
        // Check S,P, G snapshots are non-zero
        assert.isTrue(snapshot[0].eq(S_BeforeERC20)) // S
        assert.isTrue(snapshot[1].eq(P_BeforeERC20)) // P
        assert.isTrue(snapshot[2].gt(ZERO)) // GL increases a bit between each depositor op, so just check it is non-zero
        assert.equal(snapshot[3], '0') // scale
        assert.equal(snapshot[4], '0') // epoch
      }

      // All depositors make full withdrawal
      await stabilityPool.withdrawFromSP(dec(10000, 18), { from: A })
      await stabilityPool.withdrawFromSP(dec(20000, 18), { from: B })
      await stabilityPool.withdrawFromSP(dec(30000, 18), { from: C })
      await stabilityPool.withdrawFromSP(dec(40000, 18), { from: D })

      await stabilityPoolERC20.withdrawFromSP(dec(10000, 18), { from: A })
      await stabilityPoolERC20.withdrawFromSP(dec(20000, 18), { from: B })
      await stabilityPoolERC20.withdrawFromSP(dec(30000, 18), { from: C })
      await stabilityPoolERC20.withdrawFromSP(dec(40000, 18), { from: D })

      // Check all depositors' snapshots have been zero'd
      for (depositor of [A, B, C, D]) {
        const snapshot = await stabilityPool.depositSnapshots(depositor)

        // Check S, P, G snapshots are now zero
        assert.equal(snapshot[0], '0') // S
        assert.equal(snapshot[1], '0') // P
        assert.equal(snapshot[2], '0') // G
        assert.equal(snapshot[3], '0') // scale
        assert.equal(snapshot[4], '0') // epoch
      }

      for (depositor of [A, B, C, D]) {
        const snapshot = await stabilityPoolERC20.depositSnapshots(depositor)

        // Check S, P, G snapshots are now zero
        assert.equal(snapshot[0], '0') // S
        assert.equal(snapshot[1], '0') // P
        assert.equal(snapshot[2], '0') // G
        assert.equal(snapshot[3], '0') // scale
        assert.equal(snapshot[4], '0') // epoch
      }
    })

    it('withdrawFromSP(), reverts when initial deposit value is 0', async () => {
      await openTrove({
        extraDCHFAmount: toBN(dec(100000, 18)),
        ICR: toBN(dec(10, 18)),
        extraParams: { from: whale },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(100000, 18)),
        ICR: toBN(dec(10, 18)),
        extraParams: { from: whale },
      })

      // A opens trove and join the Stability Pool
      await openTrove({
        extraDCHFAmount: toBN(dec(10100, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: A },
      })
      await stabilityPool.provideToSP(dec(10000, 18), { from: A })

      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(10100, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: A },
      })
      await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: A })

      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })
      await openTrove({
        asset: erc20.address,
        ICR: toBN(dec(2, 18)),
        extraParams: { from: defaulter_1 },
      })

      //  SETUP: Execute a series of operations to trigger MON and ETH rewards for depositor A

      // Fast-forward time and make a second deposit, to trigger MON reward and make G > 0
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)
      await stabilityPool.provideToSP(dec(100, 18), { from: A })
      await stabilityPoolERC20.provideToSP(dec(100, 18), { from: A })

      // perform a liquidation to make 0 < P < 1, and S > 0
      await priceFeed.setPrice(dec(105, 18))
      assert.isFalse(await th.checkRecoveryMode(contracts))
      assert.isFalse(await th.checkRecoveryMode(contracts, erc20.address))

      await troveManager.liquidate(ZERO_ADDRESS, defaulter_1)
      await troveManager.liquidate(erc20.address, defaulter_1)
      assert.isFalse(await sortedTroves.contains(ZERO_ADDRESS, defaulter_1))
      assert.isFalse(await sortedTroves.contains(erc20.address, defaulter_1))

      await priceFeed.setPrice(dec(200, 18))

      // A successfully withraws deposit and all gains
      await stabilityPool.withdrawFromSP(dec(10100, 18), { from: A })
      await stabilityPoolERC20.withdrawFromSP(dec(10100, 18), { from: A })

      // Confirm A's recorded deposit is 0
      assert.equal(await stabilityPool.deposits(A), '0')
      assert.equal(await stabilityPoolERC20.deposits(A), '0')

      // --- TEST ---
      const expectedRevertMessage = 'StabilityPool: User must have a non-zero deposit'

      // Further withdrawal attempt from A
      await th.assertRevert(stabilityPool.withdrawFromSP(dec(10000, 18), { from: A }), expectedRevertMessage)

      await th.assertRevert(
        stabilityPoolERC20.withdrawFromSP(dec(10000, 18), { from: A }),
        expectedRevertMessage
      )

      // Withdrawal attempt of a non-existent deposit, from C
      await th.assertRevert(stabilityPool.withdrawFromSP(dec(10000, 18), { from: C }), expectedRevertMessage)
    })

    // --- withdrawETHGainToTrove ---

    it('withdrawETHGainToTrove(): reverts when user has no active deposit', async () => {
      await openTrove({
        extraDCHFAmount: toBN(dec(100000, 18)),
        ICR: toBN(dec(10, 18)),
        extraParams: { from: whale },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: alice },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: bob },
      })

      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(100000, 18)),
        ICR: toBN(dec(10, 18)),
        extraParams: { from: whale },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: alice },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: bob },
      })

      await stabilityPool.provideToSP(dec(10000, 18), { from: alice })
      await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: alice })

      const alice_initialDeposit = (await stabilityPool.deposits(alice)).toString()
      const bob_initialDeposit = (await stabilityPool.deposits(bob)).toString()

      const alice_initialDepositERC20 = (await stabilityPoolERC20.deposits(alice)).toString()
      const bob_initialDepositERC20 = (await stabilityPoolERC20.deposits(bob)).toString()

      assert.equal(alice_initialDeposit, dec(10000, 18))
      assert.equal(bob_initialDeposit, '0')

      assert.equal(alice_initialDepositERC20, dec(10000, 18))
      assert.equal(bob_initialDepositERC20, '0')

      // Defaulter opens a trove, price drops, defaulter gets liquidated
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })
      await openTrove({
        asset: erc20.address,
        ICR: toBN(dec(2, 18)),
        extraParams: { from: defaulter_1 },
      })
      await priceFeed.setPrice(dec(105, 18))

      assert.isFalse(await th.checkRecoveryMode(contracts))
      assert.isFalse(await th.checkRecoveryMode(contracts, erc20.address))

      await troveManager.liquidate(ZERO_ADDRESS, defaulter_1)
      await troveManager.liquidate(erc20.address, defaulter_1)

      assert.isFalse(await sortedTroves.contains(ZERO_ADDRESS, defaulter_1))
      assert.isFalse(await sortedTroves.contains(erc20.address, defaulter_1))

      const txAlice = await stabilityPool.withdrawAssetGainToTrove(alice, alice, {
        from: alice,
      })
      assert.isTrue(txAlice.receipt.status)

      const txAliceERC20 = await stabilityPoolERC20.withdrawAssetGainToTrove(alice, alice, {
        from: alice,
      })
      assert.isTrue(txAliceERC20.receipt.status)

      const txPromise_B = stabilityPool.withdrawAssetGainToTrove(bob, bob, { from: bob })
      await th.assertRevert(txPromise_B)

      const txPromise_BERC20 = stabilityPoolERC20.withdrawAssetGainToTrove(bob, bob, {
        from: bob,
      })
      await th.assertRevert(txPromise_BERC20)
    })

    it("withdrawETHGainToTrove(): Applies DCHFLoss to user's deposit, and redirects ETH reward to user's Trove", async () => {
      // --- SETUP ---
      // Whale deposits 185000 DCHF in StabilityPool
      await openTrove({
        extraDCHFAmount: toBN(dec(1000000, 18)),
        ICR: toBN(dec(10, 18)),
        extraParams: { from: whale },
      })
      await stabilityPool.provideToSP(dec(185000, 18), { from: whale })

      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(1000000, 18)),
        ICR: toBN(dec(10, 18)),
        extraParams: { from: whale },
      })
      await stabilityPoolERC20.provideToSP(dec(185000, 18), { from: whale })

      // Defaulter opens trove
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })
      await openTrove({
        asset: erc20.address,
        ICR: toBN(dec(2, 18)),
        extraParams: { from: defaulter_1 },
      })

      // --- TEST ---

      // Alice makes deposit #1: 15000 DCHF
      await openTrove({
        extraDCHFAmount: toBN(dec(15000, 18)),
        ICR: toBN(dec(10, 18)),
        extraParams: { from: alice },
      })
      await stabilityPool.provideToSP(dec(15000, 18), { from: alice })

      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(15000, 18)),
        ICR: toBN(dec(10, 18)),
        extraParams: { from: alice },
      })
      await stabilityPoolERC20.provideToSP(dec(15000, 18), { from: alice })

      // check Alice's Trove recorded ETH Before:
      const aliceTrove_Before = await troveManagerHelpers.Troves(alice, ZERO_ADDRESS)
      const aliceTrove_ETH_Before = aliceTrove_Before[th.TROVE_COLL_INDEX]
      assert.isTrue(aliceTrove_ETH_Before.gt(toBN('0')))

      const aliceTrove_BeforeERC20 = await troveManagerHelpers.Troves(alice, erc20.address)
      const aliceTrove_ETH_BeforeERC20 = aliceTrove_BeforeERC20[th.TROVE_COLL_INDEX]
      assert.isTrue(aliceTrove_ETH_BeforeERC20.gt(toBN('0')))

      // price drops: defaulter's Trove falls below MCR, alice and whale Trove remain active
      await priceFeed.setPrice(dec(105, 18))

      // Defaulter's Trove is closed
      const liquidationTx_1 = await troveManager.liquidate(ZERO_ADDRESS, defaulter_1, {
        from: owner,
      })
      const [liquidatedDebt, liquidatedColl, ,] = th.getEmittedLiquidationValues(liquidationTx_1)

      const liquidationTx_1ERC20 = await troveManager.liquidate(erc20.address, defaulter_1, {
        from: owner,
      })
      const [liquidatedDebtERC20, liquidatedCollERC20, ,] =
        th.getEmittedLiquidationValues(liquidationTx_1ERC20)

      const ETHGain_A = await stabilityPool.getDepositorAssetGain(alice)
      const compoundedDeposit_A = await stabilityPool.getCompoundedDCHFDeposit(alice)

      const ETHGain_AERC20 = await stabilityPoolERC20.getDepositorAssetGain(alice)
      const compoundedDeposit_AERC20 = await stabilityPoolERC20.getCompoundedDCHFDeposit(alice)

      // Alice should receive rewards proportional to her deposit as share of total deposits
      const expectedETHGain_A = liquidatedColl.mul(toBN(dec(15000, 18))).div(toBN(dec(200000, 18)))
      const expectedDCHFLoss_A = liquidatedDebt.mul(toBN(dec(15000, 18))).div(toBN(dec(200000, 18)))
      const expectedCompoundedDeposit_A = toBN(dec(15000, 18)).sub(expectedDCHFLoss_A)

      const expectedETHGain_AERC20 = liquidatedCollERC20.mul(toBN(dec(15000, 18))).div(toBN(dec(200000, 18)))
      const expectedDCHFLoss_AERC20 = liquidatedDebtERC20.mul(toBN(dec(15000, 18))).div(toBN(dec(200000, 18)))
      const expectedCompoundedDeposit_AERC20 = toBN(dec(15000, 18)).sub(expectedDCHFLoss_AERC20)

      assert.isAtMost(th.getDifference(expectedCompoundedDeposit_A, compoundedDeposit_A), 100000)
      assert.isAtMost(th.getDifference(expectedCompoundedDeposit_AERC20, compoundedDeposit_AERC20), 100000)

      // Alice sends her ETH Gains to her Trove
      await stabilityPool.withdrawAssetGainToTrove(alice, alice, { from: alice })
      await stabilityPoolERC20.withdrawAssetGainToTrove(alice, alice, { from: alice })

      // check Alice's DCHFLoss has been applied to her deposit expectedCompoundedDeposit_A
      alice_deposit_afterDefault = await stabilityPool.deposits(alice)
      assert.isAtMost(th.getDifference(alice_deposit_afterDefault, expectedCompoundedDeposit_A), 100000)

      alice_deposit_afterDefaultERC20 = await stabilityPool.deposits(alice)
      assert.isAtMost(
        th.getDifference(alice_deposit_afterDefaultERC20, expectedCompoundedDeposit_AERC20),
        100000
      )

      // check alice's Trove recorded ETH has increased by the expected reward amount
      const aliceTrove_After = await troveManagerHelpers.Troves(alice, ZERO_ADDRESS)
      const aliceTrove_ETH_After = aliceTrove_After[th.TROVE_COLL_INDEX]

      const aliceTrove_AfterERC20 = await troveManagerHelpers.Troves(alice, erc20.address)
      const aliceTrove_ETH_AfterERC20 = aliceTrove_AfterERC20[th.TROVE_COLL_INDEX]

      const Trove_ETH_Increase = aliceTrove_ETH_After.sub(aliceTrove_ETH_Before).toString()
      const Trove_ETH_IncreaseERC20 = aliceTrove_ETH_AfterERC20.sub(aliceTrove_ETH_BeforeERC20).toString()

      assert.equal(Trove_ETH_Increase, ETHGain_A)
      assert.equal(
        toBN(Trove_ETH_IncreaseERC20)
          .div(toBN(10 ** 10))
          .toString(),
        ETHGain_AERC20
      )
    })

    it('withdrawETHGainToTrove(): reverts if it would leave trove with ICR < MCR', async () => {
      // --- SETUP ---
      // Whale deposits 1850 DCHF in StabilityPool
      await openTrove({
        extraDCHFAmount: toBN(dec(1000000, 18)),
        ICR: toBN(dec(10, 18)),
        extraParams: { from: whale },
      })
      await stabilityPool.provideToSP(dec(185000, 18), { from: whale })

      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(1000000, 18)),
        ICR: toBN(dec(10, 18)),
        extraParams: { from: whale },
      })
      await stabilityPoolERC20.provideToSP(dec(185000, 18), { from: whale })

      // defaulter opened
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })
      await openTrove({
        asset: erc20.address,
        ICR: toBN(dec(2, 18)),
        extraParams: { from: defaulter_1 },
      })

      // --- TEST ---

      // Alice makes deposit #1: 15000 DCHF
      await openTrove({
        extraDCHFAmount: toBN(dec(15000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: alice },
      })
      await stabilityPool.provideToSP(dec(15000, 18), { from: alice })

      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(15000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: alice },
      })
      await stabilityPoolERC20.provideToSP(dec(15000, 18), { from: alice })

      // check alice's Trove recorded ETH Before:
      const aliceTrove_Before = await troveManagerHelpers.Troves(alice, ZERO_ADDRESS)
      const aliceTrove_ETH_Before = aliceTrove_Before[1]
      assert.isTrue(aliceTrove_ETH_Before.gt(toBN('0')))

      const aliceTrove_BeforeERC20 = await troveManagerHelpers.Troves(alice, erc20.address)
      const aliceTrove_ETH_BeforeERC20 = aliceTrove_BeforeERC20[1]
      assert.isTrue(aliceTrove_ETH_BeforeERC20.gt(toBN('0')))

      // price drops: defaulter's Trove falls below MCR
      await priceFeed.setPrice(dec(10, 18))

      // defaulter's Trove is closed.
      await troveManager.liquidate(ZERO_ADDRESS, defaulter_1, { from: owner })
      await troveManager.liquidate(erc20.address, defaulter_1, { from: owner })

      // Alice attempts to  her ETH Gains to her Trove
      await assertRevert(
        stabilityPool.withdrawAssetGainToTrove(alice, alice, { from: alice }),
        'BorrowerOps: An operation that would result in ICR < MCR is not permitted'
      )

      await assertRevert(
        stabilityPoolERC20.withdrawAssetGainToTrove(alice, alice, { from: alice }),
        'BorrowerOps: An operation that would result in ICR < MCR is not permitted'
      )
    })

    it('withdrawETHGainToTrove(): Subsequent deposit and withdrawal attempt from same account, with no intermediate liquidations, withdraws zero ETH', async () => {
      // --- SETUP ---
      // Whale deposits 1850 DCHF in StabilityPool
      await openTrove({
        extraDCHFAmount: toBN(dec(1000000, 18)),
        ICR: toBN(dec(10, 18)),
        extraParams: { from: whale },
      })
      await stabilityPool.provideToSP(dec(185000, 18), { from: whale })

      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(1000000, 18)),
        ICR: toBN(dec(10, 18)),
        extraParams: { from: whale },
      })
      await stabilityPoolERC20.provideToSP(dec(185000, 18), { from: whale })

      // defaulter opened
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })
      await openTrove({
        asset: erc20.address,
        ICR: toBN(dec(2, 18)),
        extraParams: { from: defaulter_1 },
      })

      // --- TEST ---

      // Alice makes deposit #1: 15000 DCHF
      await openTrove({
        extraDCHFAmount: toBN(dec(15000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: alice },
      })
      await stabilityPool.provideToSP(dec(15000, 18), { from: alice })

      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(15000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: alice },
      })
      await stabilityPoolERC20.provideToSP(dec(15000, 18), { from: alice })

      // check alice's Trove recorded ETH Before:
      const aliceTrove_Before = await troveManagerHelpers.Troves(alice, ZERO_ADDRESS)
      const aliceTrove_ETH_Before = aliceTrove_Before[1]
      assert.isTrue(aliceTrove_ETH_Before.gt(toBN('0')))

      const aliceTrove_BeforeERC20 = await troveManagerHelpers.Troves(alice, erc20.address)
      const aliceTrove_ETH_BeforeERC20 = aliceTrove_BeforeERC20[1]
      assert.isTrue(aliceTrove_ETH_BeforeERC20.gt(toBN('0')))

      // price drops: defaulter's Trove falls below MCR
      await priceFeed.setPrice(dec(105, 18))

      // defaulter's Trove is closed.
      await troveManager.liquidate(ZERO_ADDRESS, defaulter_1, { from: owner })
      await troveManager.liquidate(erc20.address, defaulter_1, { from: owner })

      // price bounces back
      await priceFeed.setPrice(dec(200, 18))

      // Alice sends her ETH Gains to her Trove
      await stabilityPool.withdrawAssetGainToTrove(alice, alice, { from: alice })
      await stabilityPoolERC20.withdrawAssetGainToTrove(alice, alice, { from: alice })

      assert.equal(await stabilityPool.getDepositorAssetGain(alice), 0)
      assert.equal(await stabilityPoolERC20.getDepositorAssetGain(alice), 0)

      const ETHinSP_Before = (await stabilityPool.getAssetBalance()).toString()
      const ETHinSP_BeforeERC20 = (await stabilityPoolERC20.getAssetBalance()).toString()

      // Alice attempts second withdrawal from SP to Trove - reverts, due to 0 ETH Gain
      const txPromise_A = stabilityPool.withdrawAssetGainToTrove(alice, alice, { from: alice })
      await th.assertRevert(txPromise_A)

      const txPromise_AERC20 = stabilityPoolERC20.withdrawAssetGainToTrove(alice, alice, {
        from: alice,
      })
      await th.assertRevert(txPromise_AERC20)

      // Check ETH in pool does not change
      const ETHinSP_1 = (await stabilityPool.getAssetBalance()).toString()
      assert.equal(ETHinSP_Before, ETHinSP_1)

      const ETHinSP_1ERC20 = (await stabilityPoolERC20.getAssetBalance()).toString()
      assert.equal(ETHinSP_BeforeERC20, ETHinSP_1ERC20)

      await priceFeed.setPrice(dec(200, 18))

      // Alice attempts third withdrawal (this time, from SP to her own account)
      await stabilityPool.withdrawFromSP(dec(15000, 18), { from: alice })
      await stabilityPoolERC20.withdrawFromSP(dec(15000, 18), { from: alice })

      // Check ETH in pool does not change
      const ETHinSP_2 = (await stabilityPool.getAssetBalance()).toString()
      assert.equal(ETHinSP_Before, ETHinSP_2)

      const ETHinSP_2ERC20 = (await stabilityPoolERC20.getAssetBalance()).toString()
      assert.equal(ETHinSP_BeforeERC20, ETHinSP_2ERC20)
    })

    it('withdrawETHGainToTrove(): decreases StabilityPool ETH and increases activePool ETH', async () => {
      // --- SETUP ---
      // Whale deposits 185000 DCHF in StabilityPool
      await openTrove({
        extraDCHFAmount: toBN(dec(1000000, 18)),
        ICR: toBN(dec(10, 18)),
        extraParams: { from: whale },
      })
      await stabilityPool.provideToSP(dec(185000, 18), { from: whale })

      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(1000000, 18)),
        ICR: toBN(dec(10, 18)),
        extraParams: { from: whale },
      })
      await stabilityPoolERC20.provideToSP(dec(185000, 18), { from: whale })

      // defaulter opened
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })
      await openTrove({
        asset: erc20.address,
        ICR: toBN(dec(2, 18)),
        extraParams: { from: defaulter_1 },
      })

      // --- TEST ---

      // Alice makes deposit #1: 15000 DCHF
      await openTrove({
        extraDCHFAmount: toBN(dec(15000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: alice },
      })
      await stabilityPool.provideToSP(dec(15000, 18), { from: alice })

      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(15000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: alice },
      })
      await stabilityPoolERC20.provideToSP(dec(15000, 18), { from: alice })

      // price drops: defaulter's Trove falls below MCR
      await priceFeed.setPrice(dec(100, 18))

      // defaulter's Trove is closed.
      const liquidationTx = await troveManager.liquidate(ZERO_ADDRESS, defaulter_1)
      const [liquidatedDebt, liquidatedColl, gasComp] = th.getEmittedLiquidationValues(liquidationTx)

      const liquidationTxERC20 = await troveManager.liquidate(erc20.address, defaulter_1)
      const [liquidatedDebtERC20, liquidatedCollERC20, gasCompERC20] =
        th.getEmittedLiquidationValues(liquidationTxERC20)

      // Expect alice to be entitled to 15000/200000 of the liquidated coll
      const aliceExpectedETHGain = liquidatedColl.mul(toBN(dec(15000, 18))).div(toBN(dec(200000, 18)))
      const aliceETHGain = await stabilityPool.getDepositorAssetGain(alice)
      assert.isTrue(aliceExpectedETHGain.eq(aliceETHGain))

      const aliceExpectedETHGainERC20 = liquidatedCollERC20
        .mul(toBN(dec(15000, 18)))
        .div(toBN(dec(200000, 18)))
      const aliceETHGainERC20 = await stabilityPoolERC20.getDepositorAssetGain(alice)
      assert.isTrue(aliceExpectedETHGainERC20.div(toBN(10 ** 10)).eq(aliceETHGainERC20))

      // price bounces back
      await priceFeed.setPrice(dec(200, 18))

      //check activePool and StabilityPool Ether before retrieval:
      const active_ETH_Before = await activePool.getAssetBalance(ZERO_ADDRESS)
      const stability_ETH_Before = await stabilityPool.getAssetBalance()

      const active_ETH_BeforeERC20 = await activePool.getAssetBalance(erc20.address)
      const stability_ETH_BeforeERC20 = await stabilityPoolERC20.getAssetBalance()

      // Alice retrieves redirects ETH gain to her Trove
      await stabilityPool.withdrawAssetGainToTrove(alice, alice, { from: alice })
      await stabilityPoolERC20.withdrawAssetGainToTrove(alice, alice, { from: alice })

      const active_ETH_After = await activePool.getAssetBalance(ZERO_ADDRESS)
      const stability_ETH_After = await stabilityPool.getAssetBalance()

      const active_ETH_AfterERC20 = await activePool.getAssetBalance(erc20.address)
      const stability_ETH_AfterERC20 = await stabilityPoolERC20.getAssetBalance()

      const active_ETH_Difference = active_ETH_After.sub(active_ETH_Before) // AP ETH should increase
      const stability_ETH_Difference = stability_ETH_Before.sub(stability_ETH_After) // SP ETH should decrease

      const active_ETH_DifferenceERC20 = active_ETH_AfterERC20.sub(active_ETH_BeforeERC20) // AP ETH should increase
      const stability_ETH_DifferenceERC20 = stability_ETH_BeforeERC20.sub(stability_ETH_AfterERC20) // SP ETH should decrease

      // check Pool ETH values change by Alice's AssetGain, i.e 0.075 ETH
      assert.isAtMost(th.getDifference(active_ETH_Difference, aliceETHGain), 10000)
      assert.isAtMost(th.getDifference(stability_ETH_Difference, aliceETHGain), 10000)

      assert.isAtMost(
        th.getDifference(active_ETH_DifferenceERC20.div(toBN(10 ** 10)), aliceETHGainERC20),
        10000
      )
      assert.isAtMost(
        th.getDifference(stability_ETH_DifferenceERC20.div(toBN(10 ** 10)), aliceETHGainERC20),
        10000
      )
    })

    it('withdrawETHGainToTrove(): All depositors are able to withdraw their ETH gain from the SP to their Trove', async () => {
      // Whale opens trove
      await openTrove({
        extraDCHFAmount: toBN(dec(100000, 18)),
        ICR: toBN(dec(10, 18)),
        extraParams: { from: whale },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(100000, 18)),
        ICR: toBN(dec(10, 18)),
        extraParams: { from: whale },
      })

      // Defaulter opens trove
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })
      await openTrove({
        asset: erc20.address,
        ICR: toBN(dec(2, 18)),
        extraParams: { from: defaulter_1 },
      })

      // 6 Accounts open troves and provide to SP
      const depositors = [alice, bob, carol, dennis, erin, flyn]
      for (account of depositors) {
        await openTrove({
          extraDCHFAmount: toBN(dec(10000, 18)),
          ICR: toBN(dec(2, 18)),
          extraParams: { from: account },
        })
        await stabilityPool.provideToSP(dec(10000, 18), { from: account })
      }

      for (account of depositors) {
        await openTrove({
          asset: erc20.address,
          extraDCHFAmount: toBN(dec(10000, 18)),
          ICR: toBN(dec(2, 18)),
          extraParams: { from: account },
        })
        await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: account })
      }

      await priceFeed.setPrice(dec(105, 18))
      await troveManager.liquidate(ZERO_ADDRESS, defaulter_1)
      await troveManager.liquidate(erc20.address, defaulter_1)

      // price bounces back
      await priceFeed.setPrice(dec(200, 18))

      // All depositors attempt to withdraw
      const tx1 = await stabilityPool.withdrawAssetGainToTrove(alice, alice, { from: alice })
      assert.isTrue(tx1.receipt.status)
      const tx2 = await stabilityPool.withdrawAssetGainToTrove(bob, bob, { from: bob })
      assert.isTrue(tx2.receipt.status)
      const tx3 = await stabilityPool.withdrawAssetGainToTrove(carol, carol, { from: carol })
      assert.isTrue(tx3.receipt.status)
      const tx4 = await stabilityPool.withdrawAssetGainToTrove(dennis, dennis, {
        from: dennis,
      })
      assert.isTrue(tx4.receipt.status)
      const tx5 = await stabilityPool.withdrawAssetGainToTrove(erin, erin, { from: erin })
      assert.isTrue(tx5.receipt.status)
      const tx6 = await stabilityPool.withdrawAssetGainToTrove(flyn, flyn, { from: flyn })
      assert.isTrue(tx6.receipt.status)

      const tx1ERC20 = await stabilityPoolERC20.withdrawAssetGainToTrove(alice, alice, {
        from: alice,
      })
      assert.isTrue(tx1ERC20.receipt.status)
      const tx2ERC20 = await stabilityPoolERC20.withdrawAssetGainToTrove(bob, bob, {
        from: bob,
      })
      assert.isTrue(tx2ERC20.receipt.status)
      const tx3ERC20 = await stabilityPoolERC20.withdrawAssetGainToTrove(carol, carol, {
        from: carol,
      })
      assert.isTrue(tx3ERC20.receipt.status)
      const tx4ERC20 = await stabilityPoolERC20.withdrawAssetGainToTrove(dennis, dennis, {
        from: dennis,
      })
      assert.isTrue(tx4ERC20.receipt.status)
      const tx5ERC20 = await stabilityPoolERC20.withdrawAssetGainToTrove(erin, erin, {
        from: erin,
      })
      assert.isTrue(tx5ERC20.receipt.status)
      const tx6ERC20 = await stabilityPoolERC20.withdrawAssetGainToTrove(flyn, flyn, {
        from: flyn,
      })
      assert.isTrue(tx6ERC20.receipt.status)
    })

    it('withdrawETHGainToTrove(): All depositors withdraw, each withdraw their correct ETH gain', async () => {
      // Whale opens trove
      await openTrove({
        extraDCHFAmount: toBN(dec(100000, 18)),
        ICR: toBN(dec(10, 18)),
        extraParams: { from: whale },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(100000, 18)),
        ICR: toBN(dec(10, 18)),
        extraParams: { from: whale },
      })

      // defaulter opened
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })
      await openTrove({
        asset: erc20.address,
        ICR: toBN(dec(2, 18)),
        extraParams: { from: defaulter_1 },
      })

      // 6 Accounts open troves and provide to SP
      const depositors = [alice, bob, carol, dennis, erin, flyn]
      for (account of depositors) {
        await openTrove({
          extraDCHFAmount: toBN(dec(10000, 18)),
          ICR: toBN(dec(2, 18)),
          extraParams: { from: account },
        })
        await stabilityPool.provideToSP(dec(10000, 18), { from: account })
      }

      for (account of depositors) {
        await openTrove({
          asset: erc20.address,
          extraDCHFAmount: toBN(dec(10000, 18)),
          ICR: toBN(dec(2, 18)),
          extraParams: { from: account },
        })
        await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: account })
      }

      const collBefore = (await troveManagerHelpers.Troves(alice, ZERO_ADDRESS))[th.TROVE_COLL_INDEX] // all troves have same coll before
      const collBeforeERC20 = (await troveManagerHelpers.Troves(alice, erc20.address))[th.TROVE_COLL_INDEX] // all troves have same coll before

      await priceFeed.setPrice(dec(105, 18))
      const liquidationTx = await troveManager.liquidate(ZERO_ADDRESS, defaulter_1)
      const [, liquidatedColl, ,] = th.getEmittedLiquidationValues(liquidationTx)

      const liquidationTxERC20 = await troveManager.liquidate(erc20.address, defaulter_1)
      const [, liquidatedCollERC20, ,] = th.getEmittedLiquidationValues(liquidationTxERC20)

      /* All depositors attempt to withdraw their ETH gain to their Trove. Each depositor
      receives (liquidatedColl/ 6).

      Thus, expected new collateral for each depositor with 1 Ether in their trove originally, is
      (1 + liquidatedColl/6)
      */

      const expectedCollGain = liquidatedColl.div(toBN('6'))
      const expectedCollGainERC20 = liquidatedCollERC20.div(toBN('6'))

      await priceFeed.setPrice(dec(200, 18))

      await stabilityPool.withdrawAssetGainToTrove(alice, alice, { from: alice })
      const aliceCollAfter = (await troveManagerHelpers.Troves(alice, ZERO_ADDRESS))[th.TROVE_COLL_INDEX]
      assert.isAtMost(th.getDifference(aliceCollAfter.sub(collBefore), expectedCollGain), 10000)

      await stabilityPoolERC20.withdrawAssetGainToTrove(alice, alice, { from: alice })
      const aliceCollAfterERC20 = (await troveManagerHelpers.Troves(alice, erc20.address))[
        th.TROVE_COLL_INDEX
      ]
      assert.isAtMost(
        th.getDifference(aliceCollAfterERC20.sub(collBeforeERC20), expectedCollGainERC20),
        10000
      )

      await stabilityPool.withdrawAssetGainToTrove(bob, bob, { from: bob })
      const bobCollAfter = (await troveManagerHelpers.Troves(bob, ZERO_ADDRESS))[th.TROVE_COLL_INDEX]
      assert.isAtMost(th.getDifference(bobCollAfter.sub(collBefore), expectedCollGain), 10000)

      await stabilityPoolERC20.withdrawAssetGainToTrove(bob, bob, { from: bob })
      const bobCollAfterERC20 = (await troveManagerHelpers.Troves(bob, erc20.address))[th.TROVE_COLL_INDEX]
      assert.isAtMost(th.getDifference(bobCollAfterERC20.sub(collBeforeERC20), expectedCollGainERC20), 10000)

      await stabilityPool.withdrawAssetGainToTrove(carol, carol, { from: carol })
      const carolCollAfter = (await troveManagerHelpers.Troves(carol, ZERO_ADDRESS))[th.TROVE_COLL_INDEX]
      assert.isAtMost(th.getDifference(carolCollAfter.sub(collBefore), expectedCollGain), 10000)

      await stabilityPoolERC20.withdrawAssetGainToTrove(carol, carol, { from: carol })
      const carolCollAfterERC20 = (await troveManagerHelpers.Troves(carol, erc20.address))[
        th.TROVE_COLL_INDEX
      ]
      assert.isAtMost(
        th.getDifference(carolCollAfterERC20.sub(collBeforeERC20), expectedCollGainERC20),
        10000
      )

      await stabilityPool.withdrawAssetGainToTrove(dennis, dennis, { from: dennis })
      const dennisCollAfter = (await troveManagerHelpers.Troves(dennis, ZERO_ADDRESS))[th.TROVE_COLL_INDEX]
      assert.isAtMost(th.getDifference(dennisCollAfter.sub(collBefore), expectedCollGain), 10000)

      await stabilityPoolERC20.withdrawAssetGainToTrove(dennis, dennis, { from: dennis })
      const dennisCollAfterERC20 = (await troveManagerHelpers.Troves(dennis, erc20.address))[
        th.TROVE_COLL_INDEX
      ]
      assert.isAtMost(
        th.getDifference(dennisCollAfterERC20.sub(collBeforeERC20), expectedCollGainERC20),
        10000
      )

      await stabilityPool.withdrawAssetGainToTrove(erin, erin, { from: erin })
      const erinCollAfter = (await troveManagerHelpers.Troves(erin, ZERO_ADDRESS))[th.TROVE_COLL_INDEX]
      assert.isAtMost(th.getDifference(erinCollAfter.sub(collBefore), expectedCollGain), 10000)

      await stabilityPoolERC20.withdrawAssetGainToTrove(erin, erin, { from: erin })
      const erinCollAfterERC20 = (await troveManagerHelpers.Troves(erin, erc20.address))[th.TROVE_COLL_INDEX]
      assert.isAtMost(th.getDifference(erinCollAfterERC20.sub(collBeforeERC20), expectedCollGainERC20), 10000)

      await stabilityPool.withdrawAssetGainToTrove(flyn, flyn, { from: flyn })
      const flynCollAfter = (await troveManagerHelpers.Troves(flyn, ZERO_ADDRESS))[th.TROVE_COLL_INDEX]
      assert.isAtMost(th.getDifference(flynCollAfter.sub(collBefore), expectedCollGain), 10000)

      await stabilityPoolERC20.withdrawAssetGainToTrove(flyn, flyn, { from: flyn })
      const flynCollAfterERC20 = (await troveManagerHelpers.Troves(flyn, erc20.address))[th.TROVE_COLL_INDEX]
      assert.isAtMost(th.getDifference(flynCollAfterERC20.sub(collBeforeERC20), expectedCollGainERC20), 10000)
    })

    it('withdrawETHGainToTrove(): caller can withdraw full deposit and ETH gain to their trove during Recovery Mode', async () => {
      // --- SETUP ---

      // Defaulter opens
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })
      await openTrove({
        asset: erc20.address,
        ICR: toBN(dec(2, 18)),
        extraParams: { from: defaulter_1 },
      })

      // A, B, C open troves
      await openTrove({
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: alice },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(20000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: bob },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(30000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: carol },
      })

      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: alice },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(20000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: bob },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(30000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: carol },
      })

      // A, B, C provides 10000, 5000, 3000 DCHF to SP
      await stabilityPool.provideToSP(dec(10000, 18), { from: alice })
      await stabilityPool.provideToSP(dec(5000, 18), { from: bob })
      await stabilityPool.provideToSP(dec(3000, 18), { from: carol })

      await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: alice })
      await stabilityPoolERC20.provideToSP(dec(5000, 18), { from: bob })
      await stabilityPoolERC20.provideToSP(dec(3000, 18), { from: carol })

      assert.isFalse(await th.checkRecoveryMode(contracts))
      assert.isFalse(await th.checkRecoveryMode(contracts, erc20.address))

      // Price drops to 105,
      await priceFeed.setPrice(dec(105, 18))
      const price = await priceFeed.getPrice()

      assert.isTrue(await th.checkRecoveryMode(contracts))
      assert.isTrue(await th.checkRecoveryMode(contracts, erc20.address))

      // Check defaulter 1 has ICR: 100% < ICR < 110%.
      assert.isTrue(await th.ICRbetween100and110(defaulter_1, troveManagerHelpers, price))
      assert.isTrue(await th.ICRbetween100and110(defaulter_1, troveManagerHelpers, price, erc20.address))

      const alice_Collateral_Before = (await troveManagerHelpers.Troves(alice, ZERO_ADDRESS))[
        th.TROVE_COLL_INDEX
      ]
      const bob_Collateral_Before = (await troveManagerHelpers.Troves(bob, ZERO_ADDRESS))[th.TROVE_COLL_INDEX]
      const carol_Collateral_Before = (await troveManagerHelpers.Troves(carol, ZERO_ADDRESS))[
        th.TROVE_COLL_INDEX
      ]

      const alice_Collateral_BeforeERC20 = (await troveManagerHelpers.Troves(alice, erc20.address))[
        th.TROVE_COLL_INDEX
      ]
      const bob_Collateral_BeforeERC20 = (await troveManagerHelpers.Troves(bob, erc20.address))[
        th.TROVE_COLL_INDEX
      ]
      const carol_Collateral_BeforeERC20 = (await troveManagerHelpers.Troves(carol, erc20.address))[
        th.TROVE_COLL_INDEX
      ]

      // Liquidate defaulter 1
      assert.isTrue(await sortedTroves.contains(ZERO_ADDRESS, defaulter_1))
      await troveManager.liquidate(ZERO_ADDRESS, defaulter_1)
      assert.isFalse(await sortedTroves.contains(ZERO_ADDRESS, defaulter_1))

      assert.isTrue(await sortedTroves.contains(erc20.address, defaulter_1))
      await troveManager.liquidate(erc20.address, defaulter_1)
      assert.isFalse(await sortedTroves.contains(erc20.address, defaulter_1))

      const alice_ETHGain_Before = await stabilityPool.getDepositorAssetGain(alice)
      const bob_ETHGain_Before = await stabilityPool.getDepositorAssetGain(bob)
      const carol_ETHGain_Before = await stabilityPool.getDepositorAssetGain(carol)

      const alice_ETHGain_BeforeERC20 = await stabilityPoolERC20.getDepositorAssetGain(alice)
      const bob_ETHGain_BeforeERC20 = await stabilityPoolERC20.getDepositorAssetGain(bob)
      const carol_ETHGain_BeforeERC20 = await stabilityPoolERC20.getDepositorAssetGain(carol)

      // A, B, C withdraw their full ETH gain from the Stability Pool to their trove
      await stabilityPool.withdrawAssetGainToTrove(alice, alice, { from: alice })
      await stabilityPool.withdrawAssetGainToTrove(bob, bob, { from: bob })
      await stabilityPool.withdrawAssetGainToTrove(carol, carol, { from: carol })

      await stabilityPoolERC20.withdrawAssetGainToTrove(alice, alice, { from: alice })
      await stabilityPoolERC20.withdrawAssetGainToTrove(bob, bob, { from: bob })
      await stabilityPoolERC20.withdrawAssetGainToTrove(carol, carol, { from: carol })

      // Check collateral of troves A, B, C has increased by the value of their ETH gain from liquidations, respectively
      const alice_expectedCollateral = alice_Collateral_Before.add(alice_ETHGain_Before).toString()
      const bob_expectedColalteral = bob_Collateral_Before.add(bob_ETHGain_Before).toString()
      const carol_expectedCollateral = carol_Collateral_Before.add(carol_ETHGain_Before).toString()

      const alice_expectedCollateralERC20 = alice_Collateral_BeforeERC20
        .div(toBN(10 ** 10))
        .add(alice_ETHGain_BeforeERC20)
        .toString()
      const bob_expectedColalteralERC20 = bob_Collateral_BeforeERC20
        .div(toBN(10 ** 10))
        .add(bob_ETHGain_BeforeERC20)
        .toString()
      const carol_expectedCollateralERC20 = carol_Collateral_BeforeERC20
        .div(toBN(10 ** 10))
        .add(carol_ETHGain_BeforeERC20)
        .toString()

      const alice_Collateral_After = (await troveManagerHelpers.Troves(alice, ZERO_ADDRESS))[
        th.TROVE_COLL_INDEX
      ]
      const bob_Collateral_After = (await troveManagerHelpers.Troves(bob, ZERO_ADDRESS))[th.TROVE_COLL_INDEX]
      const carol_Collateral_After = (await troveManagerHelpers.Troves(carol, ZERO_ADDRESS))[
        th.TROVE_COLL_INDEX
      ]

      const alice_Collateral_AfterERC20 = (await troveManagerHelpers.Troves(alice, erc20.address))[
        th.TROVE_COLL_INDEX
      ]
      const bob_Collateral_AfterERC20 = (await troveManagerHelpers.Troves(bob, erc20.address))[
        th.TROVE_COLL_INDEX
      ]
      const carol_Collateral_AfterERC20 = (await troveManagerHelpers.Troves(carol, erc20.address))[
        th.TROVE_COLL_INDEX
      ]

      assert.equal(alice_expectedCollateral, alice_Collateral_After)
      assert.equal(bob_expectedColalteral, bob_Collateral_After)
      assert.equal(carol_expectedCollateral, carol_Collateral_After)

      assert.equal(alice_expectedCollateralERC20, alice_Collateral_AfterERC20.div(toBN(10 ** 10)))
      assert.equal(bob_expectedColalteralERC20, bob_Collateral_AfterERC20.div(toBN(10 ** 10)))
      assert.equal(carol_expectedCollateralERC20, carol_Collateral_AfterERC20.div(toBN(10 ** 10)))

      // Check ETH in SP has reduced to zero
      const ETHinSP_After = (await stabilityPool.getAssetBalance()).toString()
      assert.isAtMost(th.getDifference(ETHinSP_After, '0'), 100000)

      const ETHinSP_AfterERC20 = (await stabilityPoolERC20.getAssetBalance()).toString()
      assert.isAtMost(th.getDifference(ETHinSP_AfterERC20, '0'), 100000)
    })

    it('withdrawETHGainToTrove(): reverts if user has no trove', async () => {
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
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: alice },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(20000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: bob },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(30000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: carol },
      })

      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: alice },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(20000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: bob },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(30000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: carol },
      })

      // Defaulter opens
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })
      await openTrove({
        asset: erc20.address,
        ICR: toBN(dec(2, 18)),
        extraParams: { from: defaulter_1 },
      })

      // A transfers DCHF to D
      await dchfToken.transfer(dennis, dec(20000, 18), { from: alice })

      // D deposits to Stability Pool
      await stabilityPool.provideToSP(dec(10000, 18), { from: dennis })
      await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: dennis })

      //Price drops
      await priceFeed.setPrice(dec(105, 18))

      //Liquidate defaulter 1
      await troveManager.liquidate(ZERO_ADDRESS, defaulter_1)
      assert.isFalse(await sortedTroves.contains(ZERO_ADDRESS, defaulter_1))

      await troveManager.liquidate(erc20.address, defaulter_1)
      assert.isFalse(await sortedTroves.contains(erc20.address, defaulter_1))

      await priceFeed.setPrice(dec(200, 18))

      // D attempts to withdraw his ETH gain to Trove
      await th.assertRevert(
        stabilityPool.withdrawAssetGainToTrove(dennis, dennis, { from: dennis }),
        'caller must have an active trove to withdraw AssetGain to'
      )
      await th.assertRevert(
        stabilityPoolERC20.withdrawAssetGainToTrove(dennis, dennis, { from: dennis }),
        'caller must have an active trove to withdraw AssetGain to'
      )
    })

    it('withdrawETHGainToTrove(): triggers MON reward event - increases the sum G', async () => {
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
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: A },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(20000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: B },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(30000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: C },
      })

      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: A },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(20000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: B },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(30000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: C },
      })

      // A and B provide to SP
      await stabilityPool.provideToSP(dec(10000, 18), { from: A })
      await stabilityPool.provideToSP(dec(10000, 18), { from: B })

      await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: A })
      await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: B })

      // Defaulter opens a trove, price drops, defaulter gets liquidated
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })
      await openTrove({
        asset: erc20.address,
        ICR: toBN(dec(2, 18)),
        extraParams: { from: defaulter_1 },
      })
      await priceFeed.setPrice(dec(105, 18))
      assert.isFalse(await th.checkRecoveryMode(contracts))
      assert.isFalse(await th.checkRecoveryMode(contracts, erc20.address))
      await troveManager.liquidate(ZERO_ADDRESS, defaulter_1)
      await troveManager.liquidate(erc20.address, defaulter_1)
      assert.isFalse(await sortedTroves.contains(ZERO_ADDRESS, defaulter_1))
      assert.isFalse(await sortedTroves.contains(erc20.address, defaulter_1))

      const G_Before = await stabilityPool.epochToScaleToG(0, 0)
      const G_BeforeERC20 = await stabilityPoolERC20.epochToScaleToG(0, 0)

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

      await priceFeed.setPrice(dec(200, 18))

      // A withdraws from SP
      await stabilityPool.withdrawFromSP(dec(50, 18), { from: A })
      await stabilityPoolERC20.withdrawFromSP(dec(50, 18), { from: A })

      const G_1 = await stabilityPool.epochToScaleToG(0, 0)
      const G_1ERC20 = await stabilityPoolERC20.epochToScaleToG(0, 0)

      // Expect G has increased from the MON reward event triggered
      assert.isTrue(G_1.gt(G_Before))
      assert.isTrue(G_1ERC20.gt(G_BeforeERC20))

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

      // Check B has non-zero ETH gain
      assert.isTrue((await stabilityPool.getDepositorAssetGain(B)).gt(ZERO))
      assert.isTrue((await stabilityPoolERC20.getDepositorAssetGain(B)).gt(ZERO))

      // B withdraws to trove
      await stabilityPool.withdrawAssetGainToTrove(B, B, { from: B })
      await stabilityPoolERC20.withdrawAssetGainToTrove(B, B, { from: B })

      const G_2 = await stabilityPool.epochToScaleToG(0, 0)
      const G_2ERC20 = await stabilityPoolERC20.epochToScaleToG(0, 0)

      // Expect G has increased from the MON reward event triggered
      assert.isTrue(G_2.gt(G_1))
      assert.isTrue(G_2ERC20.gt(G_1ERC20))
    })

    it("withdrawETHGainToTrove(), partial withdrawal: doesn't change the front end tag", async () => {
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
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: A },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(20000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: B },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(30000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: C },
      })

      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: A },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(20000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: B },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(30000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: C },
      })

      // A, B, C, D, E provide to SP
      await stabilityPool.provideToSP(dec(10000, 18), { from: A })
      await stabilityPool.provideToSP(dec(20000, 18), { from: B })
      await stabilityPool.provideToSP(dec(30000, 18), { from: C })

      await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: A })
      await stabilityPoolERC20.provideToSP(dec(20000, 18), { from: B })
      await stabilityPoolERC20.provideToSP(dec(30000, 18), { from: C })

      // Defaulter opens a trove, price drops, defaulter gets liquidated
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })
      await openTrove({
        asset: erc20.address,
        ICR: toBN(dec(2, 18)),
        extraParams: { from: defaulter_1 },
      })

      await priceFeed.setPrice(dec(105, 18))

      assert.isFalse(await th.checkRecoveryMode(contracts))
      assert.isFalse(await th.checkRecoveryMode(contracts, erc20.address))

      await troveManager.liquidate(ZERO_ADDRESS, defaulter_1)
      await troveManager.liquidate(erc20.address, defaulter_1)

      assert.isFalse(await sortedTroves.contains(ZERO_ADDRESS, defaulter_1))
      assert.isFalse(await sortedTroves.contains(erc20.address, defaulter_1))

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

      // Check A, B, C have non-zero ETH gain
      assert.isTrue((await stabilityPool.getDepositorAssetGain(A)).gt(ZERO))
      assert.isTrue((await stabilityPool.getDepositorAssetGain(B)).gt(ZERO))
      assert.isTrue((await stabilityPool.getDepositorAssetGain(C)).gt(ZERO))

      assert.isTrue((await stabilityPoolERC20.getDepositorAssetGain(A)).gt(ZERO))
      assert.isTrue((await stabilityPoolERC20.getDepositorAssetGain(B)).gt(ZERO))
      assert.isTrue((await stabilityPoolERC20.getDepositorAssetGain(C)).gt(ZERO))

      await priceFeed.setPrice(dec(200, 18))

      // A, B, C withdraw to trove
      await stabilityPool.withdrawAssetGainToTrove(A, A, { from: A })
      await stabilityPool.withdrawAssetGainToTrove(B, B, { from: B })
      await stabilityPool.withdrawAssetGainToTrove(C, C, { from: C })

      await stabilityPoolERC20.withdrawAssetGainToTrove(A, A, { from: A })
      await stabilityPoolERC20.withdrawAssetGainToTrove(B, B, { from: B })
      await stabilityPoolERC20.withdrawAssetGainToTrove(C, C, { from: C })
    })

    it('withdrawETHGainToTrove(), eligible deposit: depositor receives MON rewards', async () => {
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
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: A },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(20000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: B },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(30000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: C },
      })

      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: A },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(20000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: B },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(30000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: C },
      })

      // A, B, C, provide to SP
      await stabilityPool.provideToSP(dec(1000, 18), { from: A })
      await stabilityPool.provideToSP(dec(2000, 18), { from: B })
      await stabilityPool.provideToSP(dec(3000, 18), { from: C })

      await stabilityPoolERC20.provideToSP(dec(1000, 18), { from: A })
      await stabilityPoolERC20.provideToSP(dec(2000, 18), { from: B })
      await stabilityPoolERC20.provideToSP(dec(3000, 18), { from: C })

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

      // Defaulter opens a trove, price drops, defaulter gets liquidated
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })
      await openTrove({
        asset: erc20.address,
        ICR: toBN(dec(2, 18)),
        extraParams: { from: defaulter_1 },
      })
      await priceFeed.setPrice(dec(105, 18))

      assert.isFalse(await th.checkRecoveryMode(contracts))
      assert.isFalse(await th.checkRecoveryMode(contracts, erc20.address))

      await troveManager.liquidate(ZERO_ADDRESS, defaulter_1)
      await troveManager.liquidate(erc20.address, defaulter_1)

      assert.isFalse(await sortedTroves.contains(ZERO_ADDRESS, defaulter_1))
      assert.isFalse(await sortedTroves.contains(erc20.address, defaulter_1))

      // Get A, B, C MON balance before
      const A_MONBalance_Before = await monToken.balanceOf(A)
      const B_MONBalance_Before = await monToken.balanceOf(B)
      const C_MONBalance_Before = await monToken.balanceOf(C)

      // Check A, B, C have non-zero ETH gain
      assert.isTrue((await stabilityPool.getDepositorAssetGain(A)).gt(ZERO))
      assert.isTrue((await stabilityPool.getDepositorAssetGain(B)).gt(ZERO))
      assert.isTrue((await stabilityPool.getDepositorAssetGain(C)).gt(ZERO))

      assert.isTrue((await stabilityPoolERC20.getDepositorAssetGain(A)).gt(ZERO))
      assert.isTrue((await stabilityPoolERC20.getDepositorAssetGain(B)).gt(ZERO))
      assert.isTrue((await stabilityPoolERC20.getDepositorAssetGain(C)).gt(ZERO))

      await priceFeed.setPrice(dec(200, 18))

      // A, B, C withdraw to trove
      await stabilityPool.withdrawAssetGainToTrove(A, A, { from: A })
      await stabilityPool.withdrawAssetGainToTrove(B, B, { from: B })
      await stabilityPool.withdrawAssetGainToTrove(C, C, { from: C })

      // Get MON balance after
      const A_MONBalance_After = await monToken.balanceOf(A)
      const B_MONBalance_After = await monToken.balanceOf(B)
      const C_MONBalance_After = await monToken.balanceOf(C)

      // Check MON Balance of A, B, C has increased
      assert.isTrue(A_MONBalance_After.gt(A_MONBalance_Before))
      assert.isTrue(B_MONBalance_After.gt(B_MONBalance_Before))
      assert.isTrue(C_MONBalance_After.gt(C_MONBalance_Before))

      await stabilityPoolERC20.withdrawAssetGainToTrove(A, A, { from: A })
      await stabilityPoolERC20.withdrawAssetGainToTrove(B, B, { from: B })
      await stabilityPoolERC20.withdrawAssetGainToTrove(C, C, { from: C })

      // Get MON balance after
      const A_MONBalance_AfterERC20 = await monToken.balanceOf(A)
      const B_MONBalance_AfterERC20 = await monToken.balanceOf(B)
      const C_MONBalance_AfterERC20 = await monToken.balanceOf(C)

      // Check MON Balance of A, B, C has increased
      assert.isTrue(A_MONBalance_AfterERC20.gt(A_MONBalance_After))
      assert.isTrue(B_MONBalance_AfterERC20.gt(B_MONBalance_After))
      assert.isTrue(C_MONBalance_AfterERC20.gt(C_MONBalance_After))
    })

    it("withdrawETHGainToTrove(), eligible deposit: System's stake decreases", async () => {
      await openTrove({
        extraDCHFAmount: toBN(dec(100000, 18)),
        ICR: toBN(dec(10, 18)),
        extraParams: { from: whale },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(100000, 18)),
        ICR: toBN(dec(10, 18)),
        extraParams: { from: whale },
      })

      // A, B, C, D, E, F open troves
      await openTrove({
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: A },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(20000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: B },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(30000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: C },
      })

      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: A },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(20000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: B },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(30000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: C },
      })

      // A, B, C, D, E, F provide to SP
      await stabilityPool.provideToSP(dec(1000, 18), { from: A })
      await stabilityPool.provideToSP(dec(2000, 18), { from: B })
      await stabilityPool.provideToSP(dec(3000, 18), { from: C })

      await stabilityPoolERC20.provideToSP(dec(1000, 18), { from: A })
      await stabilityPoolERC20.provideToSP(dec(2000, 18), { from: B })
      await stabilityPoolERC20.provideToSP(dec(3000, 18), { from: C })

      // Defaulter opens a trove, price drops, defaulter gets liquidated
      await openTrove({ ICR: toBN(dec(2, 18)), extraParams: { from: defaulter_1 } })
      await openTrove({
        asset: erc20.address,
        ICR: toBN(dec(2, 18)),
        extraParams: { from: defaulter_1 },
      })
      await priceFeed.setPrice(dec(105, 18))
      assert.isFalse(await th.checkRecoveryMode(contracts))
      assert.isFalse(await th.checkRecoveryMode(contracts, erc20.address))
      await troveManager.liquidate(ZERO_ADDRESS, defaulter_1)
      await troveManager.liquidate(erc20.address, defaulter_1)
      assert.isFalse(await sortedTroves.contains(ZERO_ADDRESS, defaulter_1))
      assert.isFalse(await sortedTroves.contains(erc20.address, defaulter_1))

      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

      // Get front ends' stake before
      const Stake_Before = await stabilityPool.totalStakes()
      const Stake_BeforeERC20 = await stabilityPoolERC20.totalStakes()

      await priceFeed.setPrice(dec(200, 18))

      // Check A, B, C have non-zero ETH gain
      assert.isTrue((await stabilityPool.getDepositorAssetGain(A)).gt(ZERO))
      assert.isTrue((await stabilityPool.getDepositorAssetGain(B)).gt(ZERO))
      assert.isTrue((await stabilityPool.getDepositorAssetGain(C)).gt(ZERO))

      assert.isTrue((await stabilityPoolERC20.getDepositorAssetGain(A)).gt(ZERO))
      assert.isTrue((await stabilityPoolERC20.getDepositorAssetGain(B)).gt(ZERO))
      assert.isTrue((await stabilityPoolERC20.getDepositorAssetGain(C)).gt(ZERO))

      // A, B, C withdraw to trove
      await stabilityPool.withdrawAssetGainToTrove(A, A, { from: A })
      await stabilityPool.withdrawAssetGainToTrove(B, B, { from: B })
      await stabilityPool.withdrawAssetGainToTrove(C, C, { from: C })

      await stabilityPoolERC20.withdrawAssetGainToTrove(A, A, { from: A })
      await stabilityPoolERC20.withdrawAssetGainToTrove(B, B, { from: B })
      await stabilityPoolERC20.withdrawAssetGainToTrove(C, C, { from: C })

      // Get front ends' stakes after
      const Stake_After = await stabilityPool.totalStakes()
      const Stake_AfterERC20 = await stabilityPoolERC20.totalStakes()

      // Check front ends' stakes have decreased
      assert.isTrue(Stake_After.lt(Stake_Before))
      assert.isTrue(Stake_AfterERC20.lt(Stake_BeforeERC20))
    })

    it("withdrawETHGainToTrove(), eligible deposit: System's snapshots update", async () => {
      await openTrove({
        extraDCHFAmount: toBN(dec(100000, 18)),
        ICR: toBN(dec(10, 18)),
        extraParams: { from: whale },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(100000, 18)),
        ICR: toBN(dec(10, 18)),
        extraParams: { from: whale },
      })

      // A, B, C, open troves
      await openTrove({
        extraDCHFAmount: toBN(dec(20000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: A },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(40000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: B },
      })
      await openTrove({
        extraDCHFAmount: toBN(dec(60000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: C },
      })

      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(20000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: A },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(40000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: B },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(60000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: C },
      })

      // D opens trove
      await openTrove({
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: D },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(10000, 18)),
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

      console.log()

      // fastforward time then make an SP deposit, to make G > 0
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)

      await stabilityPool.provideToSP(dec(10000, 18), { from: D })
      await stabilityPoolERC20.provideToSP(dec(10000, 18), { from: D })

      // perform a liquidation to make 0 < P < 1, and S > 0
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

      // --- TEST ---

      // Check A, B, C have non-zero ETH gain
      assert.isTrue((await stabilityPool.getDepositorAssetGain(A)).gt(ZERO))
      assert.isTrue((await stabilityPool.getDepositorAssetGain(B)).gt(ZERO))
      assert.isTrue((await stabilityPool.getDepositorAssetGain(C)).gt(ZERO))

      assert.isTrue((await stabilityPoolERC20.getDepositorAssetGain(A)).gt(ZERO))
      assert.isTrue((await stabilityPoolERC20.getDepositorAssetGain(B)).gt(ZERO))
      assert.isTrue((await stabilityPoolERC20.getDepositorAssetGain(C)).gt(ZERO))

      await priceFeed.setPrice(dec(200, 18))

      // A, B, C withdraw ETH gain to troves. Grab G at each stage, as it can increase a bit
      // between topups, because some block.timestamp time passes (and MON is issued) between ops
      const G1 = await stabilityPool.epochToScaleToG(currentScale, currentEpoch)
      await stabilityPool.withdrawAssetGainToTrove(A, A, { from: A })

      const G1ERC20 = await stabilityPoolERC20.epochToScaleToG(currentScaleERC20, currentEpochERC20)
      await stabilityPoolERC20.withdrawAssetGainToTrove(A, A, { from: A })

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

    it('withdrawETHGainToTrove(): reverts when depositor has no ETH gain', async () => {
      await openTrove({
        extraDCHFAmount: toBN(dec(100000, 18)),
        ICR: toBN(dec(10, 18)),
        extraParams: { from: whale },
      })
      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(100000, 18)),
        ICR: toBN(dec(10, 18)),
        extraParams: { from: whale },
      })

      // Whale transfers DCHF to A, B
      await dchfToken.transfer(A, dec(20000, 18), { from: whale })
      await dchfToken.transfer(B, dec(40000, 18), { from: whale })

      // C, D open troves
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

      // A, B, C, D provide to SP
      await stabilityPool.provideToSP(dec(10, 18), { from: A })
      await stabilityPool.provideToSP(dec(20, 18), { from: B })
      await stabilityPool.provideToSP(dec(30, 18), { from: C })
      await stabilityPool.provideToSP(dec(40, 18), { from: D })

      await stabilityPoolERC20.provideToSP(dec(10, 18), { from: A })
      await stabilityPoolERC20.provideToSP(dec(20, 18), { from: B })
      await stabilityPoolERC20.provideToSP(dec(30, 18), { from: C })
      await stabilityPoolERC20.provideToSP(dec(40, 18), { from: D })

      // fastforward time, and E makes a deposit, creating MON rewards for all
      await th.fastForwardTime(timeValues.SECONDS_IN_ONE_HOUR, web3.currentProvider)
      await openTrove({
        extraDCHFAmount: toBN(dec(3000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: E },
      })
      await stabilityPool.provideToSP(dec(3000, 18), { from: E })

      await openTrove({
        asset: erc20.address,
        extraDCHFAmount: toBN(dec(3000, 18)),
        ICR: toBN(dec(2, 18)),
        extraParams: { from: E },
      })
      await stabilityPoolERC20.provideToSP(dec(3000, 18), { from: E })

      // Confirm A, B, C have zero ETH gain
      assert.equal(await stabilityPool.getDepositorAssetGain(A), '0')
      assert.equal(await stabilityPool.getDepositorAssetGain(B), '0')
      assert.equal(await stabilityPool.getDepositorAssetGain(C), '0')

      assert.equal(await stabilityPoolERC20.getDepositorAssetGain(A), '0')
      assert.equal(await stabilityPoolERC20.getDepositorAssetGain(B), '0')
      assert.equal(await stabilityPoolERC20.getDepositorAssetGain(C), '0')

      // Check withdrawETHGainToTrove reverts for A, B, C
      const txPromise_A = stabilityPool.withdrawAssetGainToTrove(A, A, { from: A })
      const txPromise_B = stabilityPool.withdrawAssetGainToTrove(B, B, { from: B })
      const txPromise_C = stabilityPool.withdrawAssetGainToTrove(C, C, { from: C })
      const txPromise_D = stabilityPool.withdrawAssetGainToTrove(D, D, { from: D })

      const txPromise_AERC20 = stabilityPoolERC20.withdrawAssetGainToTrove(A, A, { from: A })
      const txPromise_BERC20 = stabilityPoolERC20.withdrawAssetGainToTrove(B, B, { from: B })
      const txPromise_CERC20 = stabilityPoolERC20.withdrawAssetGainToTrove(C, C, { from: C })
      const txPromise_DERC20 = stabilityPoolERC20.withdrawAssetGainToTrove(D, D, { from: D })

      await th.assertRevert(txPromise_A)
      await th.assertRevert(txPromise_B)
      await th.assertRevert(txPromise_C)
      await th.assertRevert(txPromise_D)

      await th.assertRevert(txPromise_AERC20)
      await th.assertRevert(txPromise_BERC20)
      await th.assertRevert(txPromise_CERC20)
      await th.assertRevert(txPromise_DERC20)
    })
  })
})

// contract("Reset chain state", async (accounts) => {})

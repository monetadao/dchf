const { expect } = require('hardhat')
const deploymentHelper = require('../utils/deploymentHelpers.js')
const testHelpers = require('../utils/testHelpers.js')
const th = testHelpers.TestHelper
const dec = th.dec
const toBN = th.toBN
const mv = testHelpers.MoneyValues
const timeValues = testHelpers.TimeValues

const DCHFTokenTester = artifacts.require('DCHFTokenTester')
const TroveManagerTester = artifacts.require('TroveManagerTester')
const NonPayable = artifacts.require('NonPayable.sol')
const StabilityPool = artifacts.require('StabilityPool.sol')

const ZERO = toBN('0')
const ZERO_ADDRESS = th.ZERO_ADDRESS
const maxBytes32 = th.maxBytes32

// Hardhat configuration needed for this test

/*
hardhat: {
  chainId: 1,
  hardfork: 'london',
  forking: {
    url: 'https://mainnet.infura.io/v3/9aa3d95b3bc440fa88ea12eaa4456161' // Public Infura Node
  },
  allowUnlimitedContractSize: true,
  initialBaseFeePerGas: 0,
  mining: {
    auto: true,
    interval: 1000,
    mempool: {
      order: 'fifo'
    }
  },
  blockGasLimit: 150000000
}
*/

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

    // --- flashLiquidation() ---

    // skipped due to required different node config

    it.skip('flashLiquidation(): Deposits when Pool is empty, liquidates 2 Troves and withdraws the DCHF left', async () => {
      // --- SETUP ---

      // Whale opens Trove and deposits to SP
      await openTrove({
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(5, 18)),
        extraParams: { from: whale, value: dec(50, 'ether') },
      })
      const whale_Debt = await troveManagerHelpers.getTroveDebt(ZERO_ADDRESS, whale)
      const whale_Coll = await troveManagerHelpers.getTroveColl(ZERO_ADDRESS, whale)
      // console.log("Whale Trove debt:", +whale_Debt) // 1.205e+22
      // console.log("Whale Trove coll:", +whale_Coll) // 301.25e+18

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
      const defaultColl = (await troveManagerHelpers.getTroveColl(ZERO_ADDRESS, defaulter_1)).mul(toBN(2))

      // Alice makes Trove and withdraws 100 DCHF
      await openTrove({
        extraDCHFAmount: toBN(dec(100, 18)),
        ICR: toBN(dec(5, 18)),
        extraParams: { from: alice, value: dec(50, 'ether') },
      })

      const P_Init = await stabilityPool.P()
      const S_Init = await stabilityPool.epochToScaleToSum(0, 0)
      const G_Init = await stabilityPool.epochToScaleToG(0, 0)
      assert.isTrue(P_Init.eq(toBN(dec(1, 18))))
      assert.isTrue(S_Init.eq(toBN('0')))
      assert.isTrue(G_Init.eq(toBN('0')))

      // Check 'Before' snapshots
      const whale_snapshot_Init = await stabilityPool.depositSnapshots(whale)
      const whale_snapshot_S_Init = whale_snapshot_Init[0].toString()
      const whale_snapshot_P_Init = whale_snapshot_Init[1].toString()
      const whale_snapshot_G_Init = whale_snapshot_Init[2].toString()
      assert.equal(whale_snapshot_S_Init, '0')
      assert.equal(whale_snapshot_P_Init, '0')
      assert.equal(whale_snapshot_G_Init, '0')

      // price drops: defaulter's Troves fall below MCR, whale doesn't
      await priceFeed.setPrice(dec(105, 18))

      const whaleDCHF = await dchfToken.balanceOf(whale)
      console.log('Whale DCHF initial balance:', +whaleDCHF)

      const SPDCHF_Init = await stabilityPool.getTotalDCHFDeposits()
      console.log('Deposits in StabilityPool before the flashTx:', +SPDCHF_Init)

      await network.provider.send('evm_setAutomine', [false])
      await network.provider.send('evm_setIntervalMining', [15000])

      await network.provider.send('evm_mine')

      beforeBlock = (await ethers.provider.getBlock('latest')).number
      console.log('Before sending txs block:', beforeBlock)

      console.log(
        'Whale deposits 10000 DCHF to StabilityPool, makes 2 liquidations and withdraws the max DCHF'
      )
      const [tx1, tx2, tx3, tx4] = await Promise.all([
        stabilityPool.provideToSP(dec(10000, 18), { from: whale, gasLimit: 300000 }),
        troveManager.liquidate(ZERO_ADDRESS, defaulter_1, { from: whale, gasLimit: 600000 }),
        troveManager.liquidate(ZERO_ADDRESS, defaulter_2, { from: whale, gasLimit: 600000 }),
        stabilityPool.withdrawFromSP(ethers.constants.MaxUint256, {
          from: whale,
          gasLimit: 250000,
        }),
      ])
      // console.log(tx1)
      // console.log(tx2)
      // console.log(tx3)
      // console.log(tx4)

      let block = await web3.eth.getBlock('latest')
      console.log('Block txs length:', block.transactions.length)
      console.log('After sending txs block:', block.number)

      await network.provider.send('evm_setAutomine', [true])
      await network.provider.send('evm_setIntervalMining', [1000])

      assert.isFalse(await sortedTroves.contains(ZERO_ADDRESS, defaulter_1))
      assert.isFalse(await sortedTroves.contains(ZERO_ADDRESS, defaulter_2))

      const whaleDCHFAfter = await dchfToken.balanceOf(whale)
      console.log('Whale DCHF end balance:', +whaleDCHFAfter)

      // Confirm SP has decreased
      const SPDCHF_After = await stabilityPool.getTotalDCHFDeposits()
      console.log('Deposits in StabilityPool after the flashTx:', +SPDCHF_After)

      assert.isTrue(SPDCHF_After.lt(toBN(dec(10000, 18))))
    })

    it.skip('provideToSP(): Check of user snapshots of accumulated rewards per unit staked in one block', async () => {
      // --- SETUP ---

      // Whale opens Trove and deposits to SP
      await openTrove({
        extraDCHFAmount: toBN(dec(10000, 18)),
        ICR: toBN(dec(5, 18)),
        extraParams: { from: whale, value: dec(50, 'ether') },
      })
      const whale_Debt = await troveManagerHelpers.getTroveDebt(ZERO_ADDRESS, whale)
      const whale_Coll = await troveManagerHelpers.getTroveColl(ZERO_ADDRESS, whale)
      // console.log("Whale Trove debt:", +whale_Debt) // 1.205e+22
      // console.log("Whale Trove coll:", +whale_Coll) // 301.25e+18

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
      const defaultColl = (await troveManagerHelpers.getTroveColl(ZERO_ADDRESS, defaulter_1)).mul(toBN(2))

      // Alice makes Trove and withdraws 100 DCHF
      await openTrove({
        extraDCHFAmount: toBN(dec(100, 18)),
        ICR: toBN(dec(5, 18)),
        extraParams: { from: alice, value: dec(50, 'ether') },
      })

      const P_Init = await stabilityPool.P()
      const S_Init = await stabilityPool.epochToScaleToSum(0, 0)
      const G_Init = await stabilityPool.epochToScaleToG(0, 0)
      assert.isTrue(P_Init.eq(toBN(dec(1, 18))))
      assert.isTrue(S_Init.eq(toBN('0')))
      assert.isTrue(G_Init.eq(toBN('0')))

      // Check 'Before' snapshots
      const whale_snapshot_Init = await stabilityPool.depositSnapshots(whale)
      const whale_snapshot_S_Init = whale_snapshot_Init[0].toString()
      const whale_snapshot_P_Init = whale_snapshot_Init[1].toString()
      const whale_snapshot_G_Init = whale_snapshot_Init[2].toString()
      assert.equal(whale_snapshot_S_Init, '0')
      assert.equal(whale_snapshot_P_Init, '0')
      assert.equal(whale_snapshot_G_Init, '0')

      // price drops: defaulter's Troves fall below MCR, whale doesn't
      await priceFeed.setPrice(dec(105, 18))

      const whaleDCHF = await dchfToken.balanceOf(whale)
      console.log('Whale balance:', +whaleDCHF)

      await network.provider.send('evm_setAutomine', [false])
      await network.provider.send('evm_setIntervalMining', [15000])

      await network.provider.send('evm_mine')

      beforeBlock = (await ethers.provider.getBlock('latest')).number
      console.log('Before sending txs block:', beforeBlock)

      console.log('Whale deposits 10000 DCHF to StabilityPool')
      const [tx1, tx2, tx3] = await Promise.all([
        stabilityPool.provideToSP(dec(10000, 18), { from: whale, gasLimit: 300000 }),
        troveManager.liquidate(ZERO_ADDRESS, defaulter_1, { from: owner, gasLimit: 600000 }),
        troveManager.liquidate(ZERO_ADDRESS, defaulter_2, { from: owner, gasLimit: 600000 }),
      ])
      // console.log(tx1)
      // console.log(tx2)
      // console.log(tx3)

      let block = await web3.eth.getBlock('latest')
      console.log('Block txs length:', block.transactions.length)
      console.log('After sending txs block:', block.number)

      await network.provider.send('evm_setAutomine', [true])
      await network.provider.send('evm_setIntervalMining', [1000])

      assert.isFalse(await sortedTroves.contains(ZERO_ADDRESS, defaulter_1))
      assert.isFalse(await sortedTroves.contains(ZERO_ADDRESS, defaulter_2))

      // Confirm SP has decreased
      const SPDCHF_After = await stabilityPool.getTotalDCHFDeposits()
      console.log('Deposits in StabilityPool after 2 liquidations:', +SPDCHF_After)

      const P_Before = await stabilityPool.P()
      const S_Before = await stabilityPool.epochToScaleToSum(0, 0)
      const G_Before = await stabilityPool.epochToScaleToG(0, 0)
      assert.isTrue(P_Before.gt(toBN('0')))
      assert.isTrue(S_Before.gt(toBN('0')))
      // console.log("P_Before:", +P_Before) // 600000000000000000
      // console.log("S_Before:", +S_Before) // 3.98e+33
      // console.log("G_Before:", +G_Before) // 0

      const whale_Debt_After = await troveManagerHelpers.getTroveDebt(ZERO_ADDRESS, whale)
      const whale_Coll_After = await troveManagerHelpers.getTroveColl(ZERO_ADDRESS, whale)
      assert.isTrue(whale_Debt.eq(whale_Debt_After))
      assert.isTrue(whale_Coll.eq(whale_Coll_After))

      // Normal liquidations, no redistributions in place
      const pendingAssetReward = await troveManagerHelpers.getPendingAssetReward(ZERO_ADDRESS, whale)
      const pendingDebtReward = await troveManagerHelpers.getPendingDCHFDebtReward(ZERO_ADDRESS, whale)
      expect(+pendingAssetReward).to.eq(0)
      expect(+pendingDebtReward).to.eq(0)

      const depositorAssetGain = await stabilityPool.getDepositorAssetGain(whale)
      // console.log("depositorAssetGain:", +depositorAssetGain) // 39.8e+18
      const defaultCollMinusGasComp = defaultColl.mul(toBN(995)).div(toBN(1000))
      expect(+depositorAssetGain).to.eq(+defaultCollMinusGasComp)

      // Check 'Whale' snapshots
      const whale_snapshot_Before = await stabilityPool.depositSnapshots(whale)
      const whale_snapshot_S_Before = whale_snapshot_Before[0].toString()
      const whale_snapshot_P_Before = whale_snapshot_Before[1].toString()
      const whale_snapshot_G_Before = whale_snapshot_Before[2].toString()
      assert.equal(whale_snapshot_S_Before, '0')
      assert.equal(whale_snapshot_P_Before, toBN(dec(1, 18)))
      assert.equal(whale_snapshot_G_Before, '0')

      await stabilityPool.withdrawFromSP(ethers.constants.MaxUint256, {
        from: whale,
        gasLimit: 250000,
      })

      assert.isTrue(SPDCHF_After.lt(toBN(dec(10000, 18))))
    })
  })
})

contract('Reset chain state', async (accounts) => {})

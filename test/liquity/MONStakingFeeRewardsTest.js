const Decimal = require('decimal.js')
const deploymentHelper = require('../utils/deploymentHelpers.js')
const { BNConverter } = require('../utils/BNConverter.js')
const testHelpers = require('../utils/testHelpers.js')

const MONStakingTester = artifacts.require('MONStakingTester')
const TroveManagerTester = artifacts.require('TroveManagerTester')
const NonPayable = artifacts.require('./NonPayable.sol')

const th = testHelpers.TestHelper
const timeValues = testHelpers.TimeValues
const dec = th.dec
const assertRevert = th.assertRevert

const toBN = th.toBN
const ZERO = th.toBN('0')

/* NOTE: These tests do not test for specific ETH and DCHF gain values. They only test that the
 * gains are non-zero, occur when they should, and are in correct proportion to the user's stake.
 *
 * Specific ETH/DCHF gain values will depend on the final fee schedule used, and the final choices for
 * parameters BETA and MINUTE_DECAY_FACTOR in the TroveManager, which are still TBD based on economic
 * modelling.
 */

contract('MONStaking revenue share tests', async (accounts) => {
  const ZERO_ADDRESS = th.ZERO_ADDRESS

  const multisig = accounts[999]

  const [owner, A, B, C, D, E, F, G, whale] = accounts

  let priceFeed
  let dchfToken
  let sortedTroves
  let troveManager
  let troveManagerHelpers
  let activePool
  let stabilityPool
  let defaultPool
  let borrowerOperations
  let monStaking
  let monToken
  let erc20

  let contracts

  const openTrove = async (params) => th.openTrove(contracts, params)

  beforeEach(async () => {
    contracts = await deploymentHelper.deployLiquityCore()
    contracts.troveManager = await TroveManagerTester.new()
    contracts = await deploymentHelper.deployDCHFToken(contracts)
    const MONContracts = await deploymentHelper.deployMONContractsHardhat(accounts[0])

    await deploymentHelper.connectCoreContracts(contracts, MONContracts)
    await deploymentHelper.connectMONContractsToCore(MONContracts, contracts)

    nonPayable = await NonPayable.new()
    priceFeed = contracts.priceFeedTestnet
    dchfToken = contracts.dchfToken
    sortedTroves = contracts.sortedTroves
    troveManager = contracts.troveManager
    troveManagerHelpers = contracts.troveManagerHelpers
    activePool = contracts.activePool
    stabilityPool = contracts.stabilityPool
    defaultPool = contracts.defaultPool
    borrowerOperations = contracts.borrowerOperations
    hintHelpers = contracts.hintHelpers
    erc20 = contracts.erc20

    monToken = MONContracts.monToken
    monStaking = MONContracts.monStaking
    await monToken.unprotectedMint(multisig, dec(5, 24))

    let index = 0
    for (const acc of accounts) {
      await monToken.approve(monStaking.address, await web3.eth.getBalance(acc), { from: acc })
      await erc20.mint(acc, await web3.eth.getBalance(acc))
      index++

      if (index >= 20) break
    }
  })

  it('stake(): reverts if amount is zero', async () => {
    // FF time one year so owner can transfer MON
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)

    // multisig transfers MON to staker A
    await monToken.transfer(A, dec(100, 18), { from: multisig })

    await monToken.approve(monStaking.address, dec(100, 18), { from: A })
    await assertRevert(monStaking.stake(0, { from: A }), 'MONStaking: Amount must be non-zero')
  })

  it('ETH fee per MON staked increases when a redemption fee is triggered and totalStakes > 0', async () => {
    await openTrove({
      extraDCHFAmount: toBN(dec(10000, 18)),
      ICR: toBN(dec(10, 18)),
      extraParams: { from: whale },
    })
    await openTrove({
      extraDCHFAmount: toBN(dec(20000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: A },
    })
    await openTrove({
      extraDCHFAmount: toBN(dec(30000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: B },
    })
    await openTrove({
      extraDCHFAmount: toBN(dec(40000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: C },
    })

    await openTrove({
      asset: erc20.address,
      extraDCHFAmount: toBN(dec(10000, 18)),
      ICR: toBN(dec(10, 18)),
      extraParams: { from: whale },
    })
    await openTrove({
      asset: erc20.address,
      extraDCHFAmount: toBN(dec(20000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: A },
    })
    await openTrove({
      asset: erc20.address,
      extraDCHFAmount: toBN(dec(30000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: B },
    })
    await openTrove({
      asset: erc20.address,
      extraDCHFAmount: toBN(dec(40000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: C },
    })

    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)

    await monToken.transfer(A, dec(100, 18), { from: multisig })

    await monToken.approve(monStaking.address, dec(100, 18), { from: A })
    await monStaking.stake(dec(100, 18), { from: A })

    // Check ETH fee per unit staked is zero
    const F_ETH_Before = await monStaking.F_ASSETS(ZERO_ADDRESS)
    const F_ETH_Before_Asset = await monStaking.F_ASSETS(erc20.address)
    assert.equal(F_ETH_Before, '0')
    assert.equal(F_ETH_Before_Asset, '0')

    const B_BalBeforeRedemption = await dchfToken.balanceOf(B)
    // B redeems
    const redemptionTx = await th.redeemCollateralAndGetTxObject(B, contracts, dec(100, 18))
    const redemptionTx_Asset = await th.redeemCollateralAndGetTxObject(
      B,
      contracts,
      dec(100, 18),
      erc20.address
    )

    const B_BalAfterRedemption = await dchfToken.balanceOf(B)
    assert.isTrue(B_BalAfterRedemption.lt(B_BalBeforeRedemption))

    // check ETH fee emitted in event is non-zero
    const emittedETHFee = toBN(th.getEmittedRedemptionValues(redemptionTx)[3])
    const emittedETHFee_Asset = toBN(th.getEmittedRedemptionValues(redemptionTx_Asset)[3])
    assert.isTrue(emittedETHFee.gt(toBN('0')))
    assert.isTrue(emittedETHFee_Asset.gt(toBN('0')))

    // Check ETH fee per unit staked has increased by correct amount
    const F_ETH_After = await monStaking.F_ASSETS(ZERO_ADDRESS)
    const F_ETH_After_Asset = await monStaking.F_ASSETS(erc20.address)

    // Expect fee per unit staked = fee/100, since there is 100 DCHF totalStaked
    const expected_F_ETH_After = emittedETHFee.div(toBN('100'))
    const expected_F_ETH_After_Asset = emittedETHFee_Asset.div(toBN('100'))

    assert.isTrue(expected_F_ETH_After.eq(F_ETH_After))
    assert.isTrue(expected_F_ETH_After_Asset.eq(F_ETH_After_Asset))
  })

  it("ETH fee per MON staked doesn't change when a redemption fee is triggered and totalStakes == 0", async () => {
    await openTrove({
      extraDCHFAmount: toBN(dec(10000, 18)),
      ICR: toBN(dec(10, 18)),
      extraParams: { from: whale },
    })
    await openTrove({
      extraDCHFAmount: toBN(dec(20000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: A },
    })
    await openTrove({
      extraDCHFAmount: toBN(dec(30000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: B },
    })
    await openTrove({
      extraDCHFAmount: toBN(dec(40000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: C },
    })
    await openTrove({
      extraDCHFAmount: toBN(dec(50000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: D },
    })

    await openTrove({
      asset: erc20.address,
      extraDCHFAmount: toBN(dec(10000, 18)),
      ICR: toBN(dec(10, 18)),
      extraParams: { from: whale },
    })
    await openTrove({
      asset: erc20.address,
      extraDCHFAmount: toBN(dec(20000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: A },
    })
    await openTrove({
      asset: erc20.address,
      extraDCHFAmount: toBN(dec(30000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: B },
    })
    await openTrove({
      asset: erc20.address,
      extraDCHFAmount: toBN(dec(40000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: C },
    })
    await openTrove({
      asset: erc20.address,
      extraDCHFAmount: toBN(dec(50000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: D },
    })

    // FF time one year so owner can transfer MON
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)

    // multisig transfers MON to staker A
    await monToken.transfer(A, dec(100, 18), { from: multisig })

    // Check ETH fee per unit staked is zero
    assert.equal(await monStaking.F_ASSETS(ZERO_ADDRESS), '0')
    assert.equal(await monStaking.F_ASSETS(erc20.address), '0')

    const B_BalBeforeRedemption = await dchfToken.balanceOf(B)
    // B redeems
    const redemptionTx = await th.redeemCollateralAndGetTxObject(B, contracts, dec(100, 18))
    const redemptionTx_Asset = await th.redeemCollateralAndGetTxObject(
      B,
      contracts,
      dec(100, 18),
      erc20.address
    )

    const B_BalAfterRedemption = await dchfToken.balanceOf(B)
    assert.isTrue(B_BalAfterRedemption.lt(B_BalBeforeRedemption))

    // check ETH fee emitted in event is non-zero
    const emittedETHFee = toBN(th.getEmittedRedemptionValues(redemptionTx)[3])
    const emittedETHFee_Asset = toBN(th.getEmittedRedemptionValues(redemptionTx_Asset)[3])
    assert.isTrue(emittedETHFee.gt(toBN('0')))
    assert.isTrue(emittedETHFee_Asset.gt(toBN('0')))

    // Check ETH fee per unit staked has not increased
    assert.equal(await monStaking.F_ASSETS(ZERO_ADDRESS), '0')
    assert.equal(await monStaking.F_ASSETS(erc20.address), '0')
  })

  it('DCHF fee per MON staked increases when a redemption fee is triggered and totalStakes > 0', async () => {
    await openTrove({
      extraDCHFAmount: toBN(dec(10000, 18)),
      ICR: toBN(dec(10, 18)),
      extraParams: { from: whale },
    })
    await openTrove({
      extraDCHFAmount: toBN(dec(20000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: A },
    })
    await openTrove({
      extraDCHFAmount: toBN(dec(30000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: B },
    })
    await openTrove({
      extraDCHFAmount: toBN(dec(40000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: C },
    })
    await openTrove({
      extraDCHFAmount: toBN(dec(50000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: D },
    })

    await openTrove({
      asset: erc20.address,
      extraDCHFAmount: toBN(dec(10000, 18)),
      ICR: toBN(dec(10, 18)),
      extraParams: { from: whale },
    })
    await openTrove({
      asset: erc20.address,
      extraDCHFAmount: toBN(dec(20000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: A },
    })
    await openTrove({
      asset: erc20.address,
      extraDCHFAmount: toBN(dec(30000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: B },
    })
    await openTrove({
      asset: erc20.address,
      extraDCHFAmount: toBN(dec(40000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: C },
    })
    await openTrove({
      asset: erc20.address,
      extraDCHFAmount: toBN(dec(50000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: D },
    })

    // FF time one year so owner can transfer MON
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)

    // multisig transfers MON to staker A
    await monToken.transfer(A, dec(100, 18), { from: multisig })

    // A makes stake
    await monToken.approve(monStaking.address, dec(100, 18), { from: A })
    await monStaking.stake(dec(100, 18), { from: A })

    // Check DCHF fee per unit staked is zero
    assert.equal(await monStaking.F_ASSETS(ZERO_ADDRESS), '0')
    assert.equal(await monStaking.F_ASSETS(erc20.address), '0')

    const B_BalBeforeRedemption = await dchfToken.balanceOf(B)
    // B redeems
    await th.redeemCollateralAndGetTxObject(B, contracts, dec(100, 18))
    await th.redeemCollateralAndGetTxObject(B, contracts, dec(100, 18), erc20.address)

    const B_BalAfterRedemption = await dchfToken.balanceOf(B)
    assert.isTrue(B_BalAfterRedemption.lt(B_BalBeforeRedemption))

    // Check base rate is now non-zero
    assert.isTrue((await troveManagerHelpers.baseRate(ZERO_ADDRESS)).gt(toBN('0')))
    assert.isTrue((await troveManagerHelpers.baseRate(erc20.address)).gt(toBN('0')))

    // D draws debt
    const tx = await borrowerOperations.withdrawDCHF(ZERO_ADDRESS, th._100pct, dec(27, 18), D, D, { from: D })
    const tx_Asset = await borrowerOperations.withdrawDCHF(erc20.address, th._100pct, dec(27, 18), D, D, {
      from: D,
    })

    // Check DCHF fee value in event is non-zero
    const emittedDCHFFee = toBN(th.getDCHFFeeFromDCHFBorrowingEvent(tx))
    const emittedDCHFFee_Asset = toBN(th.getDCHFFeeFromDCHFBorrowingEvent(tx_Asset))
    assert.isTrue(emittedDCHFFee.gt(toBN('0')))
    assert.isTrue(emittedDCHFFee_Asset.gt(toBN('0')))

    // Check DCHF fee per unit staked has increased by correct amount
    const F_DCHF_After = await monStaking.F_DCHF()

    // Expect fee per unit staked = fee/100, since there is 100 DCHF totalStaked
    const expected_F_DCHF_After = emittedDCHFFee.div(toBN('100'))
    const expected_F_DCHF_After_Asset = emittedDCHFFee_Asset.div(toBN('100'))

    assert.isTrue(expected_F_DCHF_After.add(expected_F_DCHF_After_Asset).eq(F_DCHF_After))
  })

  it("DCHF fee per MON staked doesn't change when a redemption fee is triggered and totalStakes == 0", async () => {
    await openTrove({
      extraDCHFAmount: toBN(dec(10000, 18)),
      ICR: toBN(dec(10, 18)),
      extraParams: { from: whale },
    })
    await openTrove({
      extraDCHFAmount: toBN(dec(20000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: A },
    })
    await openTrove({
      extraDCHFAmount: toBN(dec(30000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: B },
    })
    await openTrove({
      extraDCHFAmount: toBN(dec(40000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: C },
    })
    await openTrove({
      extraDCHFAmount: toBN(dec(50000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: D },
    })

    await openTrove({
      asset: erc20.address,
      extraDCHFAmount: toBN(dec(10000, 18)),
      ICR: toBN(dec(10, 18)),
      extraParams: { from: whale },
    })
    await openTrove({
      asset: erc20.address,
      extraDCHFAmount: toBN(dec(20000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: A },
    })
    await openTrove({
      asset: erc20.address,
      extraDCHFAmount: toBN(dec(30000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: B },
    })
    await openTrove({
      asset: erc20.address,
      extraDCHFAmount: toBN(dec(40000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: C },
    })
    await openTrove({
      asset: erc20.address,
      extraDCHFAmount: toBN(dec(50000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: D },
    })

    // FF time one year so owner can transfer MON
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)

    // multisig transfers MON to staker A
    await monToken.transfer(A, dec(100, 18), { from: multisig })

    // Check DCHF fee per unit staked is zero
    assert.equal(await monStaking.F_ASSETS(ZERO_ADDRESS), '0')
    assert.equal(await monStaking.F_ASSETS(erc20.address), '0')

    const B_BalBeforeRedemption = await dchfToken.balanceOf(B)
    // B redeems
    await th.redeemCollateralAndGetTxObject(B, contracts, dec(100, 18))
    await th.redeemCollateralAndGetTxObject(B, contracts, dec(100, 18), erc20.address)

    const B_BalAfterRedemption = await dchfToken.balanceOf(B)
    assert.isTrue(B_BalAfterRedemption.lt(B_BalBeforeRedemption))

    // Check base rate is now non-zero
    assert.isTrue((await troveManagerHelpers.baseRate(ZERO_ADDRESS)).gt(toBN('0')))
    assert.isTrue((await troveManagerHelpers.baseRate(erc20.address)).gt(toBN('0')))

    // D draws debt
    const tx = await borrowerOperations.withdrawDCHF(ZERO_ADDRESS, th._100pct, dec(27, 18), D, D, { from: D })
    const tx_Asset = await borrowerOperations.withdrawDCHF(erc20.address, th._100pct, dec(27, 18), D, D, {
      from: D,
    })

    // Check DCHF fee value in event is non-zero
    assert.isTrue(toBN(th.getDCHFFeeFromDCHFBorrowingEvent(tx)).gt(toBN('0')))
    assert.isTrue(toBN(th.getDCHFFeeFromDCHFBorrowingEvent(tx_Asset)).gt(toBN('0')))

    // Check DCHF fee per unit staked did not increase, is still zero
    const F_DCHF_After = await monStaking.F_DCHF()
    assert.equal(F_DCHF_After, '0')
  })

  it('MON Staking: A single staker earns all ETH and MON fees that occur', async () => {
    await openTrove({
      extraDCHFAmount: toBN(dec(10000, 18)),
      ICR: toBN(dec(10, 18)),
      extraParams: { from: whale },
    })
    await openTrove({
      extraDCHFAmount: toBN(dec(20000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: A },
    })
    await openTrove({
      extraDCHFAmount: toBN(dec(30000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: B },
    })
    await openTrove({
      extraDCHFAmount: toBN(dec(40000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: C },
    })
    await openTrove({
      extraDCHFAmount: toBN(dec(50000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: D },
    })

    await openTrove({
      asset: erc20.address,
      extraDCHFAmount: toBN(dec(10000, 18)),
      ICR: toBN(dec(10, 18)),
      extraParams: { from: whale },
    })
    await openTrove({
      asset: erc20.address,
      extraDCHFAmount: toBN(dec(20000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: A },
    })
    await openTrove({
      asset: erc20.address,
      extraDCHFAmount: toBN(dec(30000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: B },
    })
    await openTrove({
      asset: erc20.address,
      extraDCHFAmount: toBN(dec(40000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: C },
    })
    await openTrove({
      asset: erc20.address,
      extraDCHFAmount: toBN(dec(50000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: D },
    })

    // FF time one year so owner can transfer MON
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)

    // multisig transfers MON to staker A
    await monToken.transfer(A, dec(100, 18), { from: multisig })

    // A makes stake
    await monToken.approve(monStaking.address, dec(100, 18), { from: A })
    await monStaking.stake(dec(100, 18), { from: A })

    const B_BalBeforeRedemption = await dchfToken.balanceOf(B)
    // B redeems
    const redemptionTx_1 = await th.redeemCollateralAndGetTxObject(B, contracts, dec(100, 18))
    const redemptionTx_1_Asset = await th.redeemCollateralAndGetTxObject(
      B,
      contracts,
      dec(100, 18),
      erc20.address
    )

    const B_BalAfterRedemption = await dchfToken.balanceOf(B)
    assert.isTrue(B_BalAfterRedemption.lt(B_BalBeforeRedemption))

    // check ETH fee 1 emitted in event is non-zero
    const emittedETHFee_1 = toBN(th.getEmittedRedemptionValues(redemptionTx_1)[3])
    const emittedETHFee_1_Asset = toBN(th.getEmittedRedemptionValues(redemptionTx_1_Asset)[3])
    assert.isTrue(emittedETHFee_1.gt(toBN('0')))
    assert.isTrue(emittedETHFee_1_Asset.gt(toBN('0')))

    const C_BalBeforeREdemption = await dchfToken.balanceOf(C)
    // C redeems
    const redemptionTx_2 = await th.redeemCollateralAndGetTxObject(C, contracts, dec(100, 18))
    const redemptionTx_2_Asset = await th.redeemCollateralAndGetTxObject(
      C,
      contracts,
      dec(100, 18),
      erc20.address
    )

    const C_BalAfterRedemption = await dchfToken.balanceOf(C)
    assert.isTrue(C_BalAfterRedemption.lt(C_BalBeforeREdemption))

    // check ETH fee 2 emitted in event is non-zero
    const emittedETHFee_2 = toBN(th.getEmittedRedemptionValues(redemptionTx_2)[3])
    const emittedETHFee_2_Asset = toBN(th.getEmittedRedemptionValues(redemptionTx_2_Asset)[3])
    assert.isTrue(emittedETHFee_2.gt(toBN('0')))
    assert.isTrue(emittedETHFee_2_Asset.gt(toBN('0')))

    // D draws debt
    const borrowingTx_1 = await borrowerOperations.withdrawDCHF(
      ZERO_ADDRESS,
      th._100pct,
      dec(104, 18),
      D,
      D,
      { from: D }
    )
    const borrowingTx_1_Asset = await borrowerOperations.withdrawDCHF(
      erc20.address,
      th._100pct,
      dec(104, 18),
      D,
      D,
      { from: D }
    )

    // Check DCHF fee value in event is non-zero
    const emittedDCHFFee_1 = toBN(th.getDCHFFeeFromDCHFBorrowingEvent(borrowingTx_1))
    const emittedDCHFFee_1_Asset = toBN(th.getDCHFFeeFromDCHFBorrowingEvent(borrowingTx_1_Asset))
    assert.isTrue(emittedDCHFFee_1.gt(toBN('0')))
    assert.isTrue(emittedDCHFFee_1_Asset.gt(toBN('0')))

    // B draws debt
    const borrowingTx_2 = await borrowerOperations.withdrawDCHF(ZERO_ADDRESS, th._100pct, dec(17, 18), B, B, {
      from: B,
    })
    const borrowingTx_2_Asset = await borrowerOperations.withdrawDCHF(
      erc20.address,
      th._100pct,
      dec(17, 18),
      B,
      B,
      { from: B }
    )

    // Check DCHF fee value in event is non-zero
    const emittedDCHFFee_2 = toBN(th.getDCHFFeeFromDCHFBorrowingEvent(borrowingTx_2))
    const emittedDCHFFee_2_Asset = toBN(th.getDCHFFeeFromDCHFBorrowingEvent(borrowingTx_2_Asset))
    assert.isTrue(emittedDCHFFee_2.gt(toBN('0')))
    assert.isTrue(emittedDCHFFee_2_Asset.gt(toBN('0')))

    const expectedTotalETHGain = emittedETHFee_1.add(emittedETHFee_2)
    const expectedTotalETHGain_Asset = emittedETHFee_1_Asset.add(emittedETHFee_2_Asset)

    const expectedTotalDCHFGain = emittedDCHFFee_1
      .add(emittedDCHFFee_1_Asset)
      .add(emittedDCHFFee_2)
      .add(emittedDCHFFee_2_Asset)

    const A_ETHBalance_Before = toBN(await web3.eth.getBalance(A))
    const A_ETHBalance_Before_Asset = toBN(await erc20.balanceOf(A))
    const A_DCHFBalance_Before = toBN(await dchfToken.balanceOf(A))

    // A un-stakes
    await monStaking.unstake(dec(100, 18), { from: A, gasPrice: 0 })

    const A_ETHBalance_After = toBN(await web3.eth.getBalance(A))
    const A_ETHBalance_After_Asset = toBN(await erc20.balanceOf(A))
    const A_DCHFBalance_After = toBN(await dchfToken.balanceOf(A))

    const A_ETHGain = A_ETHBalance_After.sub(A_ETHBalance_Before)
    const A_DCHFGain = A_DCHFBalance_After.sub(A_DCHFBalance_Before)

    const A_ETHGain_Asset = A_ETHBalance_After_Asset.sub(A_ETHBalance_Before_Asset)

    assert.isAtMost(th.getDifference(expectedTotalETHGain, A_ETHGain), 1000)
    assert.isAtMost(th.getDifference(expectedTotalETHGain_Asset.div(toBN(10 ** 10)), A_ETHGain_Asset), 1000)
    assert.isAtMost(th.getDifference(expectedTotalDCHFGain, A_DCHFGain), 1000)
  })

  it('stake(): Top-up sends out all accumulated ETH and DCHF gains to the staker', async () => {
    await openTrove({
      extraDCHFAmount: toBN(dec(10000, 18)),
      ICR: toBN(dec(10, 18)),
      extraParams: { from: whale },
    })
    await openTrove({
      extraDCHFAmount: toBN(dec(20000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: A },
    })
    await openTrove({
      extraDCHFAmount: toBN(dec(30000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: B },
    })
    await openTrove({
      extraDCHFAmount: toBN(dec(40000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: C },
    })
    await openTrove({
      extraDCHFAmount: toBN(dec(50000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: D },
    })

    await openTrove({
      asset: erc20.address,
      extraDCHFAmount: toBN(dec(10000, 18)),
      ICR: toBN(dec(10, 18)),
      extraParams: { from: whale },
    })
    await openTrove({
      asset: erc20.address,
      extraDCHFAmount: toBN(dec(20000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: A },
    })
    await openTrove({
      asset: erc20.address,
      extraDCHFAmount: toBN(dec(30000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: B },
    })
    await openTrove({
      asset: erc20.address,
      extraDCHFAmount: toBN(dec(40000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: C },
    })
    await openTrove({
      asset: erc20.address,
      extraDCHFAmount: toBN(dec(50000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: D },
    })

    // FF time one year so owner can transfer MON
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)

    // multisig transfers MON to staker A
    await monToken.transfer(A, dec(100, 18), { from: multisig })

    // A makes stake
    await monToken.approve(monStaking.address, dec(100, 18), { from: A })
    await monStaking.stake(dec(50, 18), { from: A })

    const B_BalBeforeRedemption = await dchfToken.balanceOf(B)
    // B redeems
    const redemptionTx_1 = await th.redeemCollateralAndGetTxObject(B, contracts, dec(100, 18))
    const redemptionTx_1_Asset = await th.redeemCollateralAndGetTxObject(
      B,
      contracts,
      dec(100, 18),
      erc20.address
    )

    const B_BalAfterRedemption = await dchfToken.balanceOf(B)
    assert.isTrue(B_BalAfterRedemption.lt(B_BalBeforeRedemption))

    // check ETH fee 1 emitted in event is non-zero
    const emittedETHFee_1 = toBN(th.getEmittedRedemptionValues(redemptionTx_1)[3])
    const emittedETHFee_1_Asset = toBN(th.getEmittedRedemptionValues(redemptionTx_1_Asset)[3])
    assert.isTrue(emittedETHFee_1.gt(toBN('0')))
    assert.isTrue(emittedETHFee_1_Asset.gt(toBN('0')))

    const C_BalBeforeREdemption = await dchfToken.balanceOf(C)
    // C redeems
    const redemptionTx_2 = await th.redeemCollateralAndGetTxObject(C, contracts, dec(100, 18))
    const redemptionTx_2_Asset = await th.redeemCollateralAndGetTxObject(
      C,
      contracts,
      dec(100, 18),
      erc20.address
    )

    const C_BalAfterRedemption = await dchfToken.balanceOf(C)
    assert.isTrue(C_BalAfterRedemption.lt(C_BalBeforeREdemption))

    // check ETH fee 2 emitted in event is non-zero
    const emittedETHFee_2 = toBN(th.getEmittedRedemptionValues(redemptionTx_2)[3])
    const emittedETHFee_2_Asset = toBN(th.getEmittedRedemptionValues(redemptionTx_2_Asset)[3])
    assert.isTrue(emittedETHFee_2.gt(toBN('0')))
    assert.isTrue(emittedETHFee_2_Asset.gt(toBN('0')))

    // D draws debt
    const borrowingTx_1 = await borrowerOperations.withdrawDCHF(
      ZERO_ADDRESS,
      th._100pct,
      dec(104, 18),
      D,
      D,
      { from: D }
    )
    const borrowingTx_1_Asset = await borrowerOperations.withdrawDCHF(
      erc20.address,
      th._100pct,
      dec(104, 18),
      D,
      D,
      { from: D }
    )

    // Check DCHF fee value in event is non-zero
    const emittedDCHFFee_1 = toBN(th.getDCHFFeeFromDCHFBorrowingEvent(borrowingTx_1))
    const emittedDCHFFee_1_Asset = toBN(th.getDCHFFeeFromDCHFBorrowingEvent(borrowingTx_1_Asset))
    assert.isTrue(emittedDCHFFee_1.gt(toBN('0')))
    assert.isTrue(emittedDCHFFee_1_Asset.gt(toBN('0')))

    // B draws debt
    const borrowingTx_2 = await borrowerOperations.withdrawDCHF(ZERO_ADDRESS, th._100pct, dec(17, 18), B, B, {
      from: B,
    })
    const borrowingTx_2_Asset = await borrowerOperations.withdrawDCHF(
      erc20.address,
      th._100pct,
      dec(17, 18),
      B,
      B,
      { from: B }
    )

    // Check DCHF fee value in event is non-zero
    const emittedDCHFFee_2 = toBN(th.getDCHFFeeFromDCHFBorrowingEvent(borrowingTx_2))
    const emittedDCHFFee_2_Asset = toBN(th.getDCHFFeeFromDCHFBorrowingEvent(borrowingTx_2_Asset))
    assert.isTrue(emittedDCHFFee_2.gt(toBN('0')))
    assert.isTrue(emittedDCHFFee_2_Asset.gt(toBN('0')))

    const expectedTotalETHGain = emittedETHFee_1.add(emittedETHFee_2)
    const expectedTotalETHGain_Asset = emittedETHFee_1_Asset.add(emittedETHFee_2_Asset)

    const expectedTotalDCHFGain = emittedDCHFFee_1
      .add(emittedDCHFFee_1_Asset)
      .add(emittedDCHFFee_2.add(emittedDCHFFee_2_Asset))

    const A_ETHBalance_Before = toBN(await web3.eth.getBalance(A))
    const A_ETHBalance_Before_Asset = toBN(await erc20.balanceOf(A))
    const A_DCHFBalance_Before = toBN(await dchfToken.balanceOf(A))

    // A tops up
    await monStaking.stake(dec(50, 18), { from: A, gasPrice: 0 })

    const A_ETHBalance_After = toBN(await web3.eth.getBalance(A))
    const A_ETHBalance_After_Asset = toBN(await erc20.balanceOf(A))
    const A_DCHFBalance_After = toBN(await dchfToken.balanceOf(A))

    const A_ETHGain = A_ETHBalance_After.sub(A_ETHBalance_Before)
    const A_ETHGain_Asset = A_ETHBalance_After_Asset.sub(A_ETHBalance_Before_Asset)
    const A_DCHFGain = A_DCHFBalance_After.sub(A_DCHFBalance_Before)

    assert.isAtMost(th.getDifference(expectedTotalETHGain, A_ETHGain), 1000)
    assert.isAtMost(th.getDifference(expectedTotalETHGain_Asset.div(toBN(10 ** 10)), A_ETHGain_Asset), 1000)
    assert.isAtMost(th.getDifference(expectedTotalDCHFGain, A_DCHFGain), 1000)
  })

  it("getPendingETHGain(): Returns the staker's correct pending ETH gain", async () => {
    await openTrove({
      extraDCHFAmount: toBN(dec(10000, 18)),
      ICR: toBN(dec(10, 18)),
      extraParams: { from: whale },
    })
    await openTrove({
      extraDCHFAmount: toBN(dec(20000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: A },
    })
    await openTrove({
      extraDCHFAmount: toBN(dec(30000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: B },
    })
    await openTrove({
      extraDCHFAmount: toBN(dec(40000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: C },
    })
    await openTrove({
      extraDCHFAmount: toBN(dec(50000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: D },
    })

    await openTrove({
      asset: erc20.address,
      extraDCHFAmount: toBN(dec(10000, 18)),
      ICR: toBN(dec(10, 18)),
      extraParams: { from: whale },
    })
    await openTrove({
      asset: erc20.address,
      extraDCHFAmount: toBN(dec(20000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: A },
    })
    await openTrove({
      asset: erc20.address,
      extraDCHFAmount: toBN(dec(30000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: B },
    })
    await openTrove({
      asset: erc20.address,
      extraDCHFAmount: toBN(dec(40000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: C },
    })
    await openTrove({
      asset: erc20.address,
      extraDCHFAmount: toBN(dec(50000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: D },
    })

    // FF time one year so owner can transfer MON
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)

    // multisig transfers MON to staker A
    await monToken.transfer(A, dec(100, 18), { from: multisig })

    // A makes stake
    await monToken.approve(monStaking.address, dec(100, 18), { from: A })
    await monStaking.stake(dec(50, 18), { from: A })

    const B_BalBeforeRedemption = await dchfToken.balanceOf(B)
    // B redeems
    const redemptionTx_1 = await th.redeemCollateralAndGetTxObject(B, contracts, dec(100, 18))
    const redemptionTx_1_Asset = await th.redeemCollateralAndGetTxObject(
      B,
      contracts,
      dec(100, 18),
      erc20.address
    )

    const B_BalAfterRedemption = await dchfToken.balanceOf(B)
    assert.isTrue(B_BalAfterRedemption.lt(B_BalBeforeRedemption))

    // check ETH fee 1 emitted in event is non-zero
    const emittedETHFee_1 = toBN(th.getEmittedRedemptionValues(redemptionTx_1)[3])
    const emittedETHFee_1_Asset = toBN(th.getEmittedRedemptionValues(redemptionTx_1_Asset)[3])
    assert.isTrue(emittedETHFee_1.gt(toBN('0')))
    assert.isTrue(emittedETHFee_1_Asset.gt(toBN('0')))

    const C_BalBeforeREdemption = await dchfToken.balanceOf(C)
    // C redeems
    const redemptionTx_2 = await th.redeemCollateralAndGetTxObject(C, contracts, dec(100, 18))
    const redemptionTx_2_Asset = await th.redeemCollateralAndGetTxObject(
      C,
      contracts,
      dec(100, 18),
      erc20.address
    )

    const C_BalAfterRedemption = await dchfToken.balanceOf(C)
    assert.isTrue(C_BalAfterRedemption.lt(C_BalBeforeREdemption))

    // check ETH fee 2 emitted in event is non-zero
    const emittedETHFee_2 = toBN(th.getEmittedRedemptionValues(redemptionTx_2)[3])
    const emittedETHFee_2_Asset = toBN(th.getEmittedRedemptionValues(redemptionTx_2_Asset)[3])
    assert.isTrue(emittedETHFee_2.gt(toBN('0')))
    assert.isTrue(emittedETHFee_2_Asset.gt(toBN('0')))

    const expectedTotalETHGain = emittedETHFee_1.add(emittedETHFee_2)
    const expectedTotalETHGain_Asset = emittedETHFee_1_Asset.add(emittedETHFee_2_Asset)

    const A_ETHGain = await monStaking.getPendingAssetGain(ZERO_ADDRESS, A)
    const A_ETHGain_Asset = await monStaking.getPendingAssetGain(erc20.address, A)

    assert.isAtMost(th.getDifference(expectedTotalETHGain, A_ETHGain), 1000)
    assert.isAtMost(th.getDifference(expectedTotalETHGain_Asset, A_ETHGain_Asset), 1000)
  })

  it("getPendingDCHFGain(): Returns the staker's correct pending DCHF gain", async () => {
    await openTrove({
      extraDCHFAmount: toBN(dec(10000, 18)),
      ICR: toBN(dec(10, 18)),
      extraParams: { from: whale },
    })
    await openTrove({
      extraDCHFAmount: toBN(dec(20000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: A },
    })
    await openTrove({
      extraDCHFAmount: toBN(dec(30000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: B },
    })
    await openTrove({
      extraDCHFAmount: toBN(dec(40000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: C },
    })
    await openTrove({
      extraDCHFAmount: toBN(dec(50000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: D },
    })

    await openTrove({
      asset: erc20.address,
      extraDCHFAmount: toBN(dec(10000, 18)),
      ICR: toBN(dec(10, 18)),
      extraParams: { from: whale },
    })
    await openTrove({
      asset: erc20.address,
      extraDCHFAmount: toBN(dec(20000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: A },
    })
    await openTrove({
      asset: erc20.address,
      extraDCHFAmount: toBN(dec(30000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: B },
    })
    await openTrove({
      asset: erc20.address,
      extraDCHFAmount: toBN(dec(40000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: C },
    })
    await openTrove({
      asset: erc20.address,
      extraDCHFAmount: toBN(dec(50000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: D },
    })

    // FF time one year so owner can transfer MON
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)

    // multisig transfers MON to staker A
    await monToken.transfer(A, dec(100, 18), { from: multisig })

    // A makes stake
    await monToken.approve(monStaking.address, dec(100, 18), { from: A })
    await monStaking.stake(dec(50, 18), { from: A })

    const B_BalBeforeRedemption = await dchfToken.balanceOf(B)
    // B redeems
    const redemptionTx_1 = await th.redeemCollateralAndGetTxObject(B, contracts, dec(100, 18))
    const redemptionTx_1_Asset = await th.redeemCollateralAndGetTxObject(
      B,
      contracts,
      dec(100, 18),
      erc20.address
    )

    const B_BalAfterRedemption = await dchfToken.balanceOf(B)
    assert.isTrue(B_BalAfterRedemption.lt(B_BalBeforeRedemption))

    // check ETH fee 1 emitted in event is non-zero
    const emittedETHFee_1 = toBN(th.getEmittedRedemptionValues(redemptionTx_1)[3])
    const emittedETHFee_1_Asset = toBN(th.getEmittedRedemptionValues(redemptionTx_1_Asset)[3])
    assert.isTrue(emittedETHFee_1.gt(toBN('0')))
    assert.isTrue(emittedETHFee_1_Asset.gt(toBN('0')))

    const C_BalBeforeREdemption = await dchfToken.balanceOf(C)
    // C redeems
    const redemptionTx_2 = await th.redeemCollateralAndGetTxObject(C, contracts, dec(100, 18))
    const redemptionTx_2_Asset = await th.redeemCollateralAndGetTxObject(
      C,
      contracts,
      dec(100, 18),
      erc20.address
    )

    const C_BalAfterRedemption = await dchfToken.balanceOf(C)
    assert.isTrue(C_BalAfterRedemption.lt(C_BalBeforeREdemption))

    // check ETH fee 2 emitted in event is non-zero
    const emittedETHFee_2 = toBN(th.getEmittedRedemptionValues(redemptionTx_2)[3])
    const emittedETHFee_2_Asset = toBN(th.getEmittedRedemptionValues(redemptionTx_2_Asset)[3])
    assert.isTrue(emittedETHFee_2.gt(toBN('0')))
    assert.isTrue(emittedETHFee_2_Asset.gt(toBN('0')))

    // D draws debt
    const borrowingTx_1 = await borrowerOperations.withdrawDCHF(
      ZERO_ADDRESS,
      th._100pct,
      dec(104, 18),
      D,
      D,
      { from: D }
    )
    const borrowingTx_1_Asset = await borrowerOperations.withdrawDCHF(
      erc20.address,
      th._100pct,
      dec(104, 18),
      D,
      D,
      { from: D }
    )

    // Check DCHF fee value in event is non-zero
    const emittedDCHFFee_1 = toBN(th.getDCHFFeeFromDCHFBorrowingEvent(borrowingTx_1))
    const emittedDCHFFee_1_Asset = toBN(th.getDCHFFeeFromDCHFBorrowingEvent(borrowingTx_1_Asset))
    assert.isTrue(emittedDCHFFee_1.gt(toBN('0')))
    assert.isTrue(emittedDCHFFee_1_Asset.gt(toBN('0')))

    // B draws debt
    const borrowingTx_2 = await borrowerOperations.withdrawDCHF(ZERO_ADDRESS, th._100pct, dec(17, 18), B, B, {
      from: B,
    })
    const borrowingTx_2_Asset = await borrowerOperations.withdrawDCHF(
      erc20.address,
      th._100pct,
      dec(17, 18),
      B,
      B,
      { from: B }
    )

    // Check DCHF fee value in event is non-zero
    const emittedDCHFFee_2 = toBN(th.getDCHFFeeFromDCHFBorrowingEvent(borrowingTx_2))
    const emittedDCHFFee_2_Asset = toBN(th.getDCHFFeeFromDCHFBorrowingEvent(borrowingTx_2_Asset))
    assert.isTrue(emittedDCHFFee_2.gt(toBN('0')))
    assert.isTrue(emittedDCHFFee_2_Asset.gt(toBN('0')))

    const expectedTotalDCHFGain = emittedDCHFFee_1.add(emittedDCHFFee_2)
    const expectedTotalDCHFGain_Asset = emittedDCHFFee_1_Asset.add(emittedDCHFFee_2_Asset)
    const A_DCHFGain = await monStaking.getPendingDCHFGain(A)

    assert.isAtMost(
      th.getDifference(expectedTotalDCHFGain.add(expectedTotalDCHFGain_Asset), A_DCHFGain),
      1000
    )
  })

  // - multi depositors, several rewards
  it('MON Staking: Multiple stakers earn the correct share of all ETH and MON fees, based on their stake size', async () => {
    await openTrove({
      extraDCHFAmount: toBN(dec(10000, 18)),
      ICR: toBN(dec(10, 18)),
      extraParams: { from: whale },
    })
    await openTrove({
      extraDCHFAmount: toBN(dec(20000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: A },
    })
    await openTrove({
      extraDCHFAmount: toBN(dec(30000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: B },
    })
    await openTrove({
      extraDCHFAmount: toBN(dec(40000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: C },
    })
    await openTrove({
      extraDCHFAmount: toBN(dec(50000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: D },
    })
    await openTrove({
      extraDCHFAmount: toBN(dec(40000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: E },
    })
    await openTrove({
      extraDCHFAmount: toBN(dec(50000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: F },
    })
    await openTrove({
      extraDCHFAmount: toBN(dec(50000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: G },
    })

    await openTrove({
      asset: erc20.address,
      extraDCHFAmount: toBN(dec(10000, 18)),
      ICR: toBN(dec(10, 18)),
      extraParams: { from: whale },
    })
    await openTrove({
      asset: erc20.address,
      extraDCHFAmount: toBN(dec(20000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: A },
    })
    await openTrove({
      asset: erc20.address,
      extraDCHFAmount: toBN(dec(30000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: B },
    })
    await openTrove({
      asset: erc20.address,
      extraDCHFAmount: toBN(dec(40000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: C },
    })
    await openTrove({
      asset: erc20.address,
      extraDCHFAmount: toBN(dec(50000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: D },
    })
    await openTrove({
      asset: erc20.address,
      extraDCHFAmount: toBN(dec(40000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: E },
    })
    await openTrove({
      asset: erc20.address,
      extraDCHFAmount: toBN(dec(50000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: F },
    })
    await openTrove({
      asset: erc20.address,
      extraDCHFAmount: toBN(dec(50000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: G },
    })

    // FF time one year so owner can transfer MON
    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)

    // multisig transfers MON to staker A, B, C
    await monToken.transfer(A, dec(100, 18), { from: multisig })
    await monToken.transfer(B, dec(200, 18), { from: multisig })
    await monToken.transfer(C, dec(300, 18), { from: multisig })

    // A, B, C make stake
    await monToken.approve(monStaking.address, dec(100, 18), { from: A })
    await monToken.approve(monStaking.address, dec(200, 18), { from: B })
    await monToken.approve(monStaking.address, dec(300, 18), { from: C })
    await monStaking.stake(dec(100, 18), { from: A })
    await monStaking.stake(dec(200, 18), { from: B })
    await monStaking.stake(dec(300, 18), { from: C })

    // Confirm staking contract holds 600 MON
    // console.log(`MON staking MON bal: ${await MONToken.balanceOf(monStaking.address)}`)
    assert.equal(await monToken.balanceOf(monStaking.address), dec(600, 18))
    assert.equal(await monStaking.totalMONStaked(), dec(600, 18))

    // F redeems
    const redemptionTx_1 = await th.redeemCollateralAndGetTxObject(F, contracts, dec(45, 18))
    const emittedETHFee_1 = toBN(th.getEmittedRedemptionValues(redemptionTx_1)[3])
    assert.isTrue(emittedETHFee_1.gt(toBN('0')))

    const redemptionTx_1_Asset = await th.redeemCollateralAndGetTxObject(
      F,
      contracts,
      dec(45, 18),
      erc20.address
    )
    const emittedETHFee_1_Asset = toBN(th.getEmittedRedemptionValues(redemptionTx_1_Asset)[3])
    assert.isTrue(emittedETHFee_1_Asset.gt(toBN('0')))

    // G redeems
    const redemptionTx_2 = await th.redeemCollateralAndGetTxObject(G, contracts, dec(197, 18))
    const emittedETHFee_2 = toBN(th.getEmittedRedemptionValues(redemptionTx_2)[3])
    assert.isTrue(emittedETHFee_2.gt(toBN('0')))

    const redemptionTx_2_Asset = await th.redeemCollateralAndGetTxObject(
      G,
      contracts,
      dec(197, 18),
      erc20.address
    )
    const emittedETHFee_2_Asset = toBN(th.getEmittedRedemptionValues(redemptionTx_2_Asset)[3])
    assert.isTrue(emittedETHFee_2_Asset.gt(toBN('0')))

    // F draws debt
    const borrowingTx_1 = await borrowerOperations.withdrawDCHF(
      ZERO_ADDRESS,
      th._100pct,
      dec(104, 18),
      F,
      F,
      { from: F }
    )
    const emittedDCHFFee_1 = toBN(th.getDCHFFeeFromDCHFBorrowingEvent(borrowingTx_1))
    assert.isTrue(emittedDCHFFee_1.gt(toBN('0')))

    const borrowingTx_1_Asset = await borrowerOperations.withdrawDCHF(
      erc20.address,
      th._100pct,
      dec(104, 18),
      F,
      F,
      { from: F }
    )
    const emittedDCHFFee_1_Asset = toBN(th.getDCHFFeeFromDCHFBorrowingEvent(borrowingTx_1_Asset))
    assert.isTrue(emittedDCHFFee_1_Asset.gt(toBN('0')))

    // G draws debt
    const borrowingTx_2 = await borrowerOperations.withdrawDCHF(ZERO_ADDRESS, th._100pct, dec(17, 18), G, G, {
      from: G,
    })
    const emittedDCHFFee_2 = toBN(th.getDCHFFeeFromDCHFBorrowingEvent(borrowingTx_2))
    assert.isTrue(emittedDCHFFee_2.gt(toBN('0')))

    const borrowingTx_2_Asset = await borrowerOperations.withdrawDCHF(
      erc20.address,
      th._100pct,
      dec(17, 18),
      G,
      G,
      { from: G }
    )
    const emittedDCHFFee_2_Asset = toBN(th.getDCHFFeeFromDCHFBorrowingEvent(borrowingTx_2_Asset))
    assert.isTrue(emittedDCHFFee_2_Asset.gt(toBN('0')))

    // D obtains MON from owner and makes a stake
    await monToken.transfer(D, dec(50, 18), { from: multisig })
    await monToken.approve(monStaking.address, dec(50, 18), { from: D })
    await monStaking.stake(dec(50, 18), { from: D })

    // Confirm staking contract holds 650 MON
    assert.equal(await monToken.balanceOf(monStaking.address), dec(650, 18))
    assert.equal(await monStaking.totalMONStaked(), dec(650, 18))

    // G redeems
    const redemptionTx_3 = await th.redeemCollateralAndGetTxObject(C, contracts, dec(197, 18))
    const emittedETHFee_3 = toBN(th.getEmittedRedemptionValues(redemptionTx_3)[3])
    assert.isTrue(emittedETHFee_3.gt(toBN('0')))

    const redemptionTx_3_Asset = await th.redeemCollateralAndGetTxObject(
      C,
      contracts,
      dec(197, 18),
      erc20.address
    )
    const emittedETHFee_3_Asset = toBN(th.getEmittedRedemptionValues(redemptionTx_3_Asset)[3])
    assert.isTrue(emittedETHFee_3_Asset.gt(toBN('0')))

    // G draws debt
    const borrowingTx_3 = await borrowerOperations.withdrawDCHF(ZERO_ADDRESS, th._100pct, dec(17, 18), G, G, {
      from: G,
    })
    const emittedDCHFFee_3 = toBN(th.getDCHFFeeFromDCHFBorrowingEvent(borrowingTx_3))
    assert.isTrue(emittedDCHFFee_3.gt(toBN('0')))

    const borrowingTx_3_Asset = await borrowerOperations.withdrawDCHF(
      erc20.address,
      th._100pct,
      dec(17, 18),
      G,
      G,
      { from: G }
    )
    const emittedDCHFFee_3_Asset = toBN(th.getDCHFFeeFromDCHFBorrowingEvent(borrowingTx_3_Asset))
    assert.isTrue(emittedDCHFFee_3_Asset.gt(toBN('0')))

    /*  
    Expected rewards:

    A_ETH: (100* ETHFee_1)/600 + (100* ETHFee_2)/600 + (100*ETH_Fee_3)/650
    B_ETH: (200* ETHFee_1)/600 + (200* ETHFee_2)/600 + (200*ETH_Fee_3)/650
    C_ETH: (300* ETHFee_1)/600 + (300* ETHFee_2)/600 + (300*ETH_Fee_3)/650
    D_ETH:                                             (100*ETH_Fee_3)/650

    A_DCHF: (100*DCHFFee_1 )/600 + (100* DCHFFee_2)/600 + (100*DCHFFee_3)/650
    B_DCHF: (200* DCHFFee_1)/600 + (200* DCHFFee_2)/600 + (200*DCHFFee_3)/650
    C_DCHF: (300* DCHFFee_1)/600 + (300* DCHFFee_2)/600 + (300*DCHFFee_3)/650
    D_DCHF:                                               (100*DCHFFee_3)/650
    */

    // Expected ETH gains
    const expectedETHGain_A = toBN('100')
      .mul(emittedETHFee_1)
      .div(toBN('600'))
      .add(toBN('100').mul(emittedETHFee_2).div(toBN('600')))
      .add(toBN('100').mul(emittedETHFee_3).div(toBN('650')))

    const expectedETHGain_B = toBN('200')
      .mul(emittedETHFee_1)
      .div(toBN('600'))
      .add(toBN('200').mul(emittedETHFee_2).div(toBN('600')))
      .add(toBN('200').mul(emittedETHFee_3).div(toBN('650')))

    const expectedETHGain_C = toBN('300')
      .mul(emittedETHFee_1)
      .div(toBN('600'))
      .add(toBN('300').mul(emittedETHFee_2).div(toBN('600')))
      .add(toBN('300').mul(emittedETHFee_3).div(toBN('650')))

    const expectedETHGain_D = toBN('50').mul(emittedETHFee_3).div(toBN('650'))

    const expectedETHGain_A_Asset = toBN('100')
      .mul(emittedETHFee_1_Asset)
      .div(toBN('600'))
      .add(toBN('100').mul(emittedETHFee_2_Asset).div(toBN('600')))
      .add(toBN('100').mul(emittedETHFee_3_Asset).div(toBN('650')))

    const expectedETHGain_B_Asset = toBN('200')
      .mul(emittedETHFee_1_Asset)
      .div(toBN('600'))
      .add(toBN('200').mul(emittedETHFee_2_Asset).div(toBN('600')))
      .add(toBN('200').mul(emittedETHFee_3_Asset).div(toBN('650')))

    const expectedETHGain_C_Asset = toBN('300')
      .mul(emittedETHFee_1_Asset)
      .div(toBN('600'))
      .add(toBN('300').mul(emittedETHFee_2_Asset).div(toBN('600')))
      .add(toBN('300').mul(emittedETHFee_3_Asset).div(toBN('650')))

    const expectedETHGain_D_Asset = toBN('50').mul(emittedETHFee_3_Asset).div(toBN('650'))

    // Expected DCHF gains:
    const expectedDCHFGain_A = toBN('100')
      .mul(emittedDCHFFee_1)
      .div(toBN('600'))
      .add(toBN('100').mul(emittedDCHFFee_2).div(toBN('600')))
      .add(toBN('100').mul(emittedDCHFFee_3).div(toBN('650')))

    const expectedDCHFGain_B = toBN('200')
      .mul(emittedDCHFFee_1)
      .div(toBN('600'))
      .add(toBN('200').mul(emittedDCHFFee_2).div(toBN('600')))
      .add(toBN('200').mul(emittedDCHFFee_3).div(toBN('650')))

    const expectedDCHFGain_C = toBN('300')
      .mul(emittedDCHFFee_1)
      .div(toBN('600'))
      .add(toBN('300').mul(emittedDCHFFee_2).div(toBN('600')))
      .add(toBN('300').mul(emittedDCHFFee_3).div(toBN('650')))

    const expectedDCHFGain_D = toBN('50').mul(emittedDCHFFee_3).div(toBN('650'))

    const expectedDCHFGain_A_Asset = toBN('100')
      .mul(emittedDCHFFee_1_Asset)
      .div(toBN('600'))
      .add(toBN('100').mul(emittedDCHFFee_2_Asset).div(toBN('600')))
      .add(toBN('100').mul(emittedDCHFFee_3_Asset).div(toBN('650')))

    const expectedDCHFGain_B_Asset = toBN('200')
      .mul(emittedDCHFFee_1_Asset)
      .div(toBN('600'))
      .add(toBN('200').mul(emittedDCHFFee_2_Asset).div(toBN('600')))
      .add(toBN('200').mul(emittedDCHFFee_3_Asset).div(toBN('650')))

    const expectedDCHFGain_C_Asset = toBN('300')
      .mul(emittedDCHFFee_1_Asset)
      .div(toBN('600'))
      .add(toBN('300').mul(emittedDCHFFee_2_Asset).div(toBN('600')))
      .add(toBN('300').mul(emittedDCHFFee_3_Asset).div(toBN('650')))

    const expectedDCHFGain_D_Asset = toBN('50').mul(emittedDCHFFee_3_Asset).div(toBN('650'))

    const A_ETHBalance_Before = toBN(await web3.eth.getBalance(A))
    const A_ETHBalance_Before_Asset = toBN(await erc20.balanceOf(A))
    const A_DCHFBalance_Before = toBN(await dchfToken.balanceOf(A))
    const B_ETHBalance_Before = toBN(await web3.eth.getBalance(B))
    const B_ETHBalance_Before_Asset = toBN(await erc20.balanceOf(B))
    const B_DCHFBalance_Before = toBN(await dchfToken.balanceOf(B))
    const C_ETHBalance_Before = toBN(await web3.eth.getBalance(C))
    const C_ETHBalance_Before_Asset = toBN(await erc20.balanceOf(C))
    const C_DCHFBalance_Before = toBN(await dchfToken.balanceOf(C))
    const D_ETHBalance_Before = toBN(await web3.eth.getBalance(D))
    const D_ETHBalance_Before_Asset = toBN(await erc20.balanceOf(D))
    const D_DCHFBalance_Before = toBN(await dchfToken.balanceOf(D))

    // A-D un-stake
    await monStaking.unstake(dec(100, 18), { from: A, gasPrice: 0 })
    await monStaking.unstake(dec(200, 18), { from: B, gasPrice: 0 })
    await monStaking.unstake(dec(400, 18), { from: C, gasPrice: 0 })
    await monStaking.unstake(dec(50, 18), { from: D, gasPrice: 0 })

    // Confirm all depositors could withdraw

    //Confirm pool Size is now 0
    assert.equal(await monToken.balanceOf(monStaking.address), '0')
    assert.equal(await monStaking.totalMONStaked(), '0')

    // Get A-D ETH and DCHF balances
    const A_ETHBalance_After = toBN(await web3.eth.getBalance(A))
    const A_ETHBalance_After_Asset = toBN(await erc20.balanceOf(A))
    const A_DCHFBalance_After = toBN(await dchfToken.balanceOf(A))
    const B_ETHBalance_After = toBN(await web3.eth.getBalance(B))
    const B_ETHBalance_After_Asset = toBN(await erc20.balanceOf(B))
    const B_DCHFBalance_After = toBN(await dchfToken.balanceOf(B))
    const C_ETHBalance_After = toBN(await web3.eth.getBalance(C))
    const C_ETHBalance_After_Asset = toBN(await erc20.balanceOf(C))
    const C_DCHFBalance_After = toBN(await dchfToken.balanceOf(C))
    const D_ETHBalance_After = toBN(await web3.eth.getBalance(D))
    const D_ETHBalance_After_Asset = toBN(await erc20.balanceOf(D))
    const D_DCHFBalance_After = toBN(await dchfToken.balanceOf(D))

    // Get ETH and DCHF gains
    const A_ETHGain = A_ETHBalance_After.sub(A_ETHBalance_Before)
    const A_ETHGain_Asset = A_ETHBalance_After_Asset.sub(A_ETHBalance_Before_Asset)
    const A_DCHFGain = A_DCHFBalance_After.sub(A_DCHFBalance_Before)
    const B_ETHGain = B_ETHBalance_After.sub(B_ETHBalance_Before)
    const B_ETHGain_Asset = B_ETHBalance_After_Asset.sub(B_ETHBalance_Before_Asset)
    const B_DCHFGain = B_DCHFBalance_After.sub(B_DCHFBalance_Before)
    const C_ETHGain = C_ETHBalance_After.sub(C_ETHBalance_Before)
    const C_ETHGain_Asset = C_ETHBalance_After_Asset.sub(C_ETHBalance_Before_Asset)
    const C_DCHFGain = C_DCHFBalance_After.sub(C_DCHFBalance_Before)
    const D_ETHGain = D_ETHBalance_After.sub(D_ETHBalance_Before)
    const D_ETHGain_Asset = D_ETHBalance_After_Asset.sub(D_ETHBalance_Before_Asset)
    const D_DCHFGain = D_DCHFBalance_After.sub(D_DCHFBalance_Before)

    // Check gains match expected amounts
    assert.isAtMost(th.getDifference(expectedETHGain_A, A_ETHGain), 1000)
    assert.isAtMost(th.getDifference(expectedETHGain_A_Asset.div(toBN(10 ** 10)), A_ETHGain_Asset), 1000)
    assert.isAtMost(th.getDifference(expectedETHGain_B, B_ETHGain), 1000)
    assert.isAtMost(th.getDifference(expectedETHGain_B_Asset.div(toBN(10 ** 10)), B_ETHGain_Asset), 1000)
    assert.isAtMost(th.getDifference(expectedETHGain_C, C_ETHGain), 1000)
    assert.isAtMost(th.getDifference(expectedETHGain_C_Asset.div(toBN(10 ** 10)), C_ETHGain_Asset), 1000)
    assert.isAtMost(th.getDifference(expectedETHGain_D, D_ETHGain), 1000)
    assert.isAtMost(th.getDifference(expectedETHGain_D_Asset.div(toBN(10 ** 10)), D_ETHGain_Asset), 1000)

    assert.isAtMost(th.getDifference(expectedDCHFGain_A.add(expectedDCHFGain_A_Asset), A_DCHFGain), 1000)
    assert.isAtMost(th.getDifference(expectedDCHFGain_B.add(expectedDCHFGain_B_Asset), B_DCHFGain), 1000)
    assert.isAtMost(th.getDifference(expectedDCHFGain_C.add(expectedDCHFGain_C_Asset), C_DCHFGain), 1000)
    assert.isAtMost(th.getDifference(expectedDCHFGain_D.add(expectedDCHFGain_D_Asset), D_DCHFGain), 1000)
  })

  it("unstake(): reverts if caller has ETH gains and can't receive ETH", async () => {
    await openTrove({
      extraDCHFAmount: toBN(dec(20000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: whale },
    })
    await openTrove({
      extraDCHFAmount: toBN(dec(20000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: A },
    })
    await openTrove({
      extraDCHFAmount: toBN(dec(30000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: B },
    })
    await openTrove({
      extraDCHFAmount: toBN(dec(40000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: C },
    })
    await openTrove({
      extraDCHFAmount: toBN(dec(50000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: D },
    })

    await openTrove({
      asset: erc20.address,
      extraDCHFAmount: toBN(dec(20000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: whale },
    })
    await openTrove({
      asset: erc20.address,
      extraDCHFAmount: toBN(dec(20000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: A },
    })
    await openTrove({
      asset: erc20.address,
      extraDCHFAmount: toBN(dec(30000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: B },
    })
    await openTrove({
      asset: erc20.address,
      extraDCHFAmount: toBN(dec(40000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: C },
    })
    await openTrove({
      asset: erc20.address,
      extraDCHFAmount: toBN(dec(50000, 18)),
      ICR: toBN(dec(2, 18)),
      extraParams: { from: D },
    })

    await th.fastForwardTime(timeValues.SECONDS_IN_ONE_YEAR, web3.currentProvider)

    // multisig transfers MON to staker A and the non-payable proxy
    await monToken.transfer(A, dec(100, 18), { from: multisig })
    await monToken.transfer(nonPayable.address, dec(100, 18), { from: multisig })

    //  A makes stake
    const A_stakeTx = await monStaking.stake(dec(100, 18), { from: A })
    assert.isTrue(A_stakeTx.receipt.status)

    //  A tells proxy to make a stake
    const proxyApproveTxData = await th.getTransactionData('approve(address,uint256)', [
      monStaking.address,
      '0x56bc75e2d63100000',
    ]) // proxy stakes 100 MON
    await nonPayable.forward(monToken.address, proxyApproveTxData, { from: A })

    const proxyStakeTxData = await th.getTransactionData('stake(uint256)', ['0x56bc75e2d63100000']) // proxy stakes 100 MON
    await nonPayable.forward(monStaking.address, proxyStakeTxData, { from: A })

    // B makes a redemption, creating ETH gain for proxy
    await th.redeemCollateralAndGetTxObject(B, contracts, dec(45, 18))
    await th.redeemCollateralAndGetTxObject(B, contracts, dec(45, 18), erc20.address)

    assert.isTrue((await monStaking.getPendingAssetGain(ZERO_ADDRESS, nonPayable.address)).gt(toBN('0')))
    assert.isTrue((await monStaking.getPendingAssetGain(erc20.address, nonPayable.address)).gt(toBN('0')))

    // Expect this tx to revert: stake() tries to send nonPayable proxy's accumulated ETH gain (albeit 0),
    //  A tells proxy to unstake
    const proxyUnStakeTxData = await th.getTransactionData('unstake(uint256)', ['0x56bc75e2d63100000']) // proxy stakes 100 MON
    const proxyUnstakeTxPromise = nonPayable.forward(monStaking.address, proxyUnStakeTxData, { from: A })

    // but nonPayable proxy can not accept ETH - therefore stake() reverts.
    await assertRevert(proxyUnstakeTxPromise)
  })

  it('receive(): reverts when it receives ETH from an address that is not the Active Pool', async () => {
    const ethSendTxPromise1 = web3.eth.sendTransaction({
      to: monStaking.address,
      from: A,
      value: dec(1, 'ether'),
    })
    const ethSendTxPromise2 = web3.eth.sendTransaction({
      to: monStaking.address,
      from: owner,
      value: dec(1, 'ether'),
    })

    await assertRevert(ethSendTxPromise1)
    await assertRevert(ethSendTxPromise2)
  })

  it('unstake(): reverts if user has no stake', async () => {
    const unstakeTxPromise1 = monStaking.unstake(1, { from: A })
    const unstakeTxPromise2 = monStaking.unstake(1, { from: owner })

    await assertRevert(unstakeTxPromise1)
    await assertRevert(unstakeTxPromise2)
  })

  it('Test requireCallerIsTroveManager', async () => {
    const monStakingTester = await MONStakingTester.new()
    await assertRevert(monStakingTester.requireCallerIsTroveManager(), 'MONStaking: caller is not TroveM')
  })
})

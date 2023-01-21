const deploymentHelper = require('../utils/deploymentHelpers.js')
const testHelpers = require('../utils/testHelpers.js')
const TroveManagerTester = artifacts.require('./TroveManagerTester.sol')
const TroveManagerHelpersTester = artifacts.require('./TroveManagerHelpersTester.sol')
const DCHFTokenTester = artifacts.require('./DCHFTokenTester.sol')

const th = testHelpers.TestHelper
const dec = th.dec
const toBN = th.toBN
const assertRevert = th.assertRevert
const mv = testHelpers.MoneyValues
const timeValues = testHelpers.TimeValues

/* NOTE: Some tests involving ETH redemption fees do not test for specific fee values.
 * Some only test that the fees are non-zero when they should occur.
 *
 * Specific ETH gain values will depend on the final fee schedule used, and the final choices for
 * the parameter BETA in the TroveManager, which is still TBD based on economic modelling.
 */
contract('TroveManager', async (accounts) => {
  const ZERO_ADDRESS = th.ZERO_ADDRESS
  const [owner, A, B, C, D, E, F] = accounts.slice(0, 7)

  const [bountyAddress, lpRewardsAddress, multisig] = accounts.slice(997, 1000)

  let priceFeed
  let DCHFToken
  let sortedTroves
  let troveManager
  let troveManagerHelpers
  let activePool
  let collSurplusPool
  let defaultPool
  let borrowerOperations
  let hintHelpers

  let contracts

  const getOpenTroveDCHFAmount = async (totalDebt, asset) =>
    th.getOpenTroveDCHFAmount(contracts, totalDebt, asset)

  const getSnapshotsRatio = async (asset) => {
    const ratio = (await troveManagerHelpers.totalStakesSnapshot(asset))
      .mul(toBN(dec(1, 18)))
      .div(await troveManagerHelpers.totalCollateralSnapshot(asset))

    return ratio
  }

  beforeEach(async () => {
    contracts = await deploymentHelper.deployLiquityCore()
    contracts.troveManager = await TroveManagerTester.new()
    contracts.troveManagerHelpers = await TroveManagerHelpersTester.new()
    contracts.dchfToken = await DCHFTokenTester.new(contracts.stabilityPoolManager.address)
    const MONContracts = await deploymentHelper.deployMONContractsHardhat(accounts[0])

    priceFeed = contracts.priceFeedTestnet
    DCHFToken = contracts.dchfToken
    sortedTroves = contracts.sortedTroves
    troveManager = contracts.troveManager
    troveManagerHelpers = contracts.troveManagerHelpers
    activePool = contracts.activePool
    defaultPool = contracts.defaultPool
    collSurplusPool = contracts.collSurplusPool
    borrowerOperations = contracts.borrowerOperations
    hintHelpers = contracts.hintHelpers

    MONStaking = MONContracts.MONStaking
    MONToken = MONContracts.MONToken
    communityIssuance = MONContracts.communityIssuance

    await deploymentHelper.connectCoreContracts(contracts, MONContracts)
    await deploymentHelper.connectMONContractsToCore(MONContracts, contracts)
  })

  it("A given trove's stake decline is negligible with adjustments and tiny liquidations", async () => {
    await priceFeed.setPrice(dec(100, 18))

    // Make 1 mega troves A at ~50% total collateral
    await borrowerOperations.openTrove(
      ZERO_ADDRESS,
      0,
      th._100pct,
      await getOpenTroveDCHFAmount(dec(1, 31), ZERO_ADDRESS),
      ZERO_ADDRESS,
      ZERO_ADDRESS,
      { from: A, value: dec(2, 29) }
    )

    // Make 5 large troves B, C, D, E, F at ~10% total collateral
    await borrowerOperations.openTrove(
      ZERO_ADDRESS,
      0,
      th._100pct,
      await getOpenTroveDCHFAmount(dec(2, 30), ZERO_ADDRESS),
      ZERO_ADDRESS,
      ZERO_ADDRESS,
      { from: B, value: dec(4, 28) }
    )
    await borrowerOperations.openTrove(
      ZERO_ADDRESS,
      0,
      th._100pct,
      await getOpenTroveDCHFAmount(dec(2, 30), ZERO_ADDRESS),
      ZERO_ADDRESS,
      ZERO_ADDRESS,
      { from: C, value: dec(4, 28) }
    )
    await borrowerOperations.openTrove(
      ZERO_ADDRESS,
      0,
      th._100pct,
      await getOpenTroveDCHFAmount(dec(2, 30), ZERO_ADDRESS),
      ZERO_ADDRESS,
      ZERO_ADDRESS,
      { from: D, value: dec(4, 28) }
    )
    await borrowerOperations.openTrove(
      ZERO_ADDRESS,
      0,
      th._100pct,
      await getOpenTroveDCHFAmount(dec(2, 30), ZERO_ADDRESS),
      ZERO_ADDRESS,
      ZERO_ADDRESS,
      { from: E, value: dec(4, 28) }
    )
    await borrowerOperations.openTrove(
      ZERO_ADDRESS,
      0,
      th._100pct,
      await getOpenTroveDCHFAmount(dec(2, 30), ZERO_ADDRESS),
      ZERO_ADDRESS,
      ZERO_ADDRESS,
      { from: F, value: dec(4, 28) }
    )

    // Make 10 tiny troves at relatively negligible collateral (~1e-9 of total)
    const tinyTroves = accounts.slice(10, 20)
    for (account of tinyTroves) {
      await borrowerOperations.openTrove(
        ZERO_ADDRESS,
        0,
        th._100pct,
        await getOpenTroveDCHFAmount(dec(1, 22), ZERO_ADDRESS),
        ZERO_ADDRESS,
        ZERO_ADDRESS,
        { from: account, value: dec(2, 20) }
      )
    }

    console.log(
      `B initial stake: ${(await troveManagerHelpers.Troves(B, ZERO_ADDRESS))[th.TROVE_STAKE_INDEX]}`
    )

    // liquidate 1 trove at ~50% total system collateral
    await priceFeed.setPrice(dec(50, 18))
    assert.isTrue(await troveManagerHelpers.checkRecoveryMode(ZERO_ADDRESS, await priceFeed.getPrice()))
    await troveManager.liquidate(ZERO_ADDRESS, A)

    console.log(
      `totalStakesSnapshot after L1: ${await troveManagerHelpers.totalStakesSnapshot(ZERO_ADDRESS)}`
    )
    console.log(
      `totalCollateralSnapshot after L1: ${await troveManagerHelpers.totalCollateralSnapshot(ZERO_ADDRESS)}`
    )
    console.log(`Snapshots ratio after L1: ${await getSnapshotsRatio(ZERO_ADDRESS)}`)
    console.log(
      `B pending ETH reward after L1: ${await troveManagerHelpers.getPendingAssetReward(ZERO_ADDRESS, B)}`
    )
    console.log(
      `B stake after L1: ${(await troveManagerHelpers.Troves(B, ZERO_ADDRESS))[th.TROVE_STAKE_INDEX]}`
    ) // Initial stake as it has not been yet adjusted

    // adjust trove B 1 wei: apply rewards
    await borrowerOperations.adjustTrove(
      ZERO_ADDRESS,
      0,
      th._100pct,
      0,
      1,
      false,
      ZERO_ADDRESS,
      ZERO_ADDRESS,
      { from: B }
    ) // B repays 1 wei
    console.log(
      `B stake after A1: ${(await troveManagerHelpers.Troves(B, ZERO_ADDRESS))[th.TROVE_STAKE_INDEX]}`
    )
    console.log(`Snapshots ratio after A1: ${await getSnapshotsRatio(ZERO_ADDRESS)}`)

    console.log(
      `B coll after A1: ${(await troveManagerHelpers.Troves(B, ZERO_ADDRESS))[th.TROVE_COLL_INDEX]}`
    )

    // Loop over tiny troves, and alternately:
    // - Liquidate a tiny trove
    // - Adjust B's collateral by 1 wei
    for (let [idx, trove] of tinyTroves.entries()) {
      await troveManager.liquidate(ZERO_ADDRESS, trove)
      console.log(
        `B stake after L${idx + 2}: ${
          (await troveManagerHelpers.Troves(B, ZERO_ADDRESS))[th.TROVE_STAKE_INDEX]
        }`
      )
      console.log(`Snapshots ratio after L${idx + 2}: ${await getSnapshotsRatio(ZERO_ADDRESS)}`)
      await borrowerOperations.adjustTrove(
        ZERO_ADDRESS,
        0,
        th._100pct,
        0,
        1,
        false,
        ZERO_ADDRESS,
        ZERO_ADDRESS,
        { from: B }
      ) // A repays 1 wei
      console.log(
        `B stake after A${idx + 2}: ${
          (await troveManagerHelpers.Troves(B, ZERO_ADDRESS))[th.TROVE_STAKE_INDEX]
        }`
      )
    }
  })

  // TODO: stake decline for adjustments with sizable liquidations, for comparison
})

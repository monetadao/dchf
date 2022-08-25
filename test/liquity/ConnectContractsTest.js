const deploymentHelper = require("../../utils/deploymentHelpers.js")
const StabilityPool = artifacts.require('StabilityPool.sol')
const testHelpers = require("../../utils/testHelpers.js")
const th = testHelpers.TestHelper

contract('Deployment script - Sets correct contract addresses dependencies after deployment', async accounts => {
  const [owner] = accounts;
  const ZERO_ADDRESS = th.ZERO_ADDRESS

  const [bountyAddress, lpRewardsAddress, multisig] = accounts.slice(997, 1000)

  let priceFeed
  let dchfToken
  let sortedTroves
  let troveManager
  let activePool
  let stabilityPool
  let stabilityPoolManager
  let defaultPool
  let functionCaller
  let borrowerOperations
  let monStaking
  let monToken
  let communityIssuance
  let dfrancParameters

  before(async () => {
    const coreContracts = await deploymentHelper.deployLiquityCore()
    const MONContracts = await deploymentHelper.deployMONContractsHardhat(accounts[0])

    priceFeed = coreContracts.priceFeedTestnet
    dchfToken = coreContracts.dchfToken
    sortedTroves = coreContracts.sortedTroves
    troveManager = coreContracts.troveManager
    activePool = coreContracts.activePool
    stabilityPoolManager = coreContracts.stabilityPoolManager
    defaultPool = coreContracts.defaultPool
    functionCaller = coreContracts.functionCaller
    borrowerOperations = coreContracts.borrowerOperations
    dfrancParameters = coreContracts.dfrancParameters

    monStaking = MONContracts.monStaking
    monToken = MONContracts.monToken
    communityIssuance = MONContracts.communityIssuance

    await deploymentHelper.connectCoreContracts(coreContracts, MONContracts)
    await deploymentHelper.connectMONContractsToCore(MONContracts, coreContracts)
    stabilityPool = await StabilityPool.at(await coreContracts.stabilityPoolManager.getAssetStabilityPool(ZERO_ADDRESS))
  })

  it('Check if correct Addresses in Vault Parameters', async () => {
    assert.equal(priceFeed.address, await dfrancParameters.priceFeed())
    assert.equal(activePool.address, await dfrancParameters.activePool())
    assert.equal(defaultPool.address, await dfrancParameters.defaultPool())
  })

  it('Sets the correct vestaParams address in TroveManager', async () => {
    assert.equal(dfrancParameters.address, await troveManager.vestaParams());
  })

  it('Sets the correct DCHFToken address in TroveManager', async () => {
    const DCHFTokenAddress = dchfToken.address

    const recordedClvTokenAddress = await troveManager.dchfToken()

    assert.equal(DCHFTokenAddress, recordedClvTokenAddress)
  })

  it('Sets the correct SortedTroves address in TroveManager', async () => {
    const sortedTrovesAddress = sortedTroves.address

    const recordedSortedTrovesAddress = await troveManager.sortedTroves()

    assert.equal(sortedTrovesAddress, recordedSortedTrovesAddress)
  })

  it('Sets the correct BorrowerOperations address in TroveManager', async () => {
    const borrowerOperationsAddress = borrowerOperations.address

    const recordedBorrowerOperationsAddress = await troveManager.borrowerOperationsAddress()

    assert.equal(borrowerOperationsAddress, recordedBorrowerOperationsAddress)
  })

  it('Sets the correct StabilityPool address in TroveManager', async () => {
    assert.equal(stabilityPoolManager.address, await troveManager.stabilityPoolManager())
  })

  it('Sets the correct MONStaking address in TroveManager', async () => {
    const MONStakingAddress = monStaking.address

    const recordedMONStakingAddress = await troveManager.monStaking()
    assert.equal(MONStakingAddress, recordedMONStakingAddress)
  })

  // Active Pool
  it('Sets the correct StabilityPool address in ActivePool', async () => {
    assert.equal(stabilityPoolManager.address, await activePool.stabilityPoolManager())
  })

  it('Sets the correct DefaultPool address in ActivePool', async () => {
    const defaultPoolAddress = defaultPool.address

    const recordedDefaultPoolAddress = await activePool.defaultPool()

    assert.equal(defaultPoolAddress, recordedDefaultPoolAddress)
  })

  it('Sets the correct BorrowerOperations address in ActivePool', async () => {
    const borrowerOperationsAddress = borrowerOperations.address

    const recordedBorrowerOperationsAddress = await activePool.borrowerOperationsAddress()

    assert.equal(borrowerOperationsAddress, recordedBorrowerOperationsAddress)
  })

  it('Sets the correct TroveManager address in ActivePool', async () => {
    const troveManagerAddress = troveManager.address

    const recordedTroveManagerAddress = await activePool.troveManagerAddress()
    assert.equal(troveManagerAddress, recordedTroveManagerAddress)
  })

  // Stability Pool
  it('Sets the correct BorrowerOperations address in StabilityPool', async () => {
    const borrowerOperationsAddress = borrowerOperations.address

    const recordedBorrowerOperationsAddress = await stabilityPool.borrowerOperations()

    assert.equal(borrowerOperationsAddress, recordedBorrowerOperationsAddress)
  })

  it('Sets the correct DCHFToken address in StabilityPool', async () => {
    const DCHFTokenAddress = dchfToken.address

    const recordedClvTokenAddress = await stabilityPool.dchfToken()

    assert.equal(DCHFTokenAddress, recordedClvTokenAddress)
  })

  it('Sets the correct TroveManager address in StabilityPool', async () => {
    const troveManagerAddress = troveManager.address

    const recordedTroveManagerAddress = await stabilityPool.troveManager()
    assert.equal(troveManagerAddress, recordedTroveManagerAddress)
  })

  // Default Pool

  it('Sets the correct TroveManager address in DefaultPool', async () => {
    const troveManagerAddress = troveManager.address

    const recordedTroveManagerAddress = await defaultPool.troveManagerAddress()
    assert.equal(troveManagerAddress, recordedTroveManagerAddress)
  })

  it('Sets the correct ActivePool address in DefaultPool', async () => {
    const activePoolAddress = activePool.address

    const recordedActivePoolAddress = await defaultPool.activePoolAddress()
    assert.equal(activePoolAddress, recordedActivePoolAddress)
  })

  it('Sets the correct TroveManager address in SortedTroves', async () => {
    const borrowerOperationsAddress = borrowerOperations.address

    const recordedBorrowerOperationsAddress = await sortedTroves.borrowerOperationsAddress()
    assert.equal(borrowerOperationsAddress, recordedBorrowerOperationsAddress)
  })

  it('Sets the correct BorrowerOperations address in SortedTroves', async () => {
    const troveManagerAddress = troveManager.address

    const recordedTroveManagerAddress = await sortedTroves.troveManager()
    assert.equal(troveManagerAddress, recordedTroveManagerAddress)
  })

  //--- BorrowerOperations ---

  it('Sets the correct DfrancParameters address in BorrowerOperations', async () => {
    assert.equal(dfrancParameters.address, await borrowerOperations.vestaParams())
  })

  // TroveManager in BO
  it('Sets the correct TroveManager address in BorrowerOperations', async () => {
    const troveManagerAddress = troveManager.address

    const recordedTroveManagerAddress = await borrowerOperations.troveManager()
    assert.equal(troveManagerAddress, recordedTroveManagerAddress)
  })

  // setSortedTroves in BO
  it('Sets the correct SortedTroves address in BorrowerOperations', async () => {
    const sortedTrovesAddress = sortedTroves.address

    const recordedSortedTrovesAddress = await borrowerOperations.sortedTroves()
    assert.equal(sortedTrovesAddress, recordedSortedTrovesAddress)
  })

  // MON Staking in BO
  it('Sets the correct MONStaking address in BorrowerOperations', async () => {
    const MONStakingAddress = monStaking.address

    const recordedMONStakingAddress = await borrowerOperations.MONStakingAddress()
    assert.equal(MONStakingAddress, recordedMONStakingAddress)
  })


  // --- MON Staking ---

  // Sets MONToken in MONStaking
  it('Sets the correct MONToken address in MONStaking', async () => {
    const MONTokenAddress = monToken.address

    const recordedMONTokenAddress = await monStaking.monToken()
    assert.equal(MONTokenAddress, recordedMONTokenAddress)
  })

  // Sets ActivePool in MONStaking
  it('Sets the correct ActivePool address in MONStaking', async () => {
    const activePoolAddress = activePool.address

    const recordedActivePoolAddress = await monStaking.activePoolAddress()
    assert.equal(activePoolAddress, recordedActivePoolAddress)
  })

  // Sets DCHFToken in MONStaking
  it('Sets the correct ActivePool address in MONStaking', async () => {
    const DCHFTokenAddress = dchfToken.address

    const recordedDCHFTokenAddress = await monStaking.dchfToken()
    assert.equal(DCHFTokenAddress, recordedDCHFTokenAddress)
  })

  // Sets TroveManager in MONStaking
  it('Sets the correct ActivePool address in MONStaking', async () => {
    const troveManagerAddress = troveManager.address

    const recordedTroveManagerAddress = await monStaking.troveManagerAddress()
    assert.equal(troveManagerAddress, recordedTroveManagerAddress)
  })

  // Sets BorrowerOperations in MONStaking
  it('Sets the correct BorrowerOperations address in MONStaking', async () => {
    const borrowerOperationsAddress = borrowerOperations.address

    const recordedBorrowerOperationsAddress = await monStaking.borrowerOperationsAddress()
    assert.equal(borrowerOperationsAddress, recordedBorrowerOperationsAddress)
  })

  // ---  MONToken ---

  // --- CI ---
  // Sets MONToken in CommunityIssuance
  it('Sets the correct MONToken address in CommunityIssuance', async () => {
    const MONTokenAddress = monToken.address

    const recordedMONTokenAddress = await communityIssuance.monToken()
    assert.equal(MONTokenAddress, recordedMONTokenAddress)
  })

  it('Sets the correct StabilityPool address in CommunityIssuance', async () => {
    assert.equal(stabilityPoolManager.address, await communityIssuance.stabilityPoolManager())
  })
})

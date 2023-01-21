const { current } = require('@openzeppelin/test-helpers/src/balance')
const { web3 } = require('@openzeppelin/test-helpers/src/setup')
const deploymentHelper = require('../utils/deploymentHelpers.js')
const testHelpers = require('../utils/testHelpers.js')
const TroveManagerTester = artifacts.require('./TroveManagerTester.sol')
const StabilityPool = artifacts.require('./StabilityPool.sol')
const DCHFTokenTester = artifacts.require('DCHFTokenTester')

const th = testHelpers.TestHelper
const dec = th.dec
const toBN = th.toBN

contract('AdminContract', async (accounts) => {
  const ZERO_ADDRESS = th.ZERO_ADDRESS
  const assertRevert = th.assertRevert
  const timeValues = testHelpers.TimeValues

  const [owner, user, fakeIndex, fakeOracle] = accounts

  let contracts
  let adminContract
  let monToken
  let stabilityPoolV1
  let stabilityPoolV2
  let stabilityPoolManager
  let MONContracts
  let erc20
  let dchfToken

  describe('Admin Contract', async () => {
    beforeEach(async () => {
      contracts = await deploymentHelper.deployLiquityCore()
      contracts.troveManager = await TroveManagerTester.new()
      contracts.dchfToken = await DCHFTokenTester.new(contracts.stabilityPoolManager.address)

      MONContracts = await deploymentHelper.deployMONContractsHardhat(owner)

      adminContract = contracts.adminContract
      monToken = MONContracts.monToken

      stabilityPoolManager = contracts.stabilityPoolManager

      erc20 = contracts.erc20
      dchfToken = contracts.dchfToken

      await deploymentHelper.connectCoreContracts(contracts, MONContracts)
      await deploymentHelper.connectMONContractsToCore(MONContracts, contracts)

      stabilityPoolV1 = await StabilityPool.at(await stabilityPoolManager.getAssetStabilityPool(ZERO_ADDRESS))
      stabilityPoolV2 = await StabilityPool.at(
        await stabilityPoolManager.getAssetStabilityPool(erc20.address)
      )

      stabilityPoolV3 = await StabilityPool.new()
      await stabilityPoolV3.setAddresses(
        dchfToken.address,
        contracts.borrowerOperations.address,
        contracts.troveManager.address,
        contracts.troveManagerHelpers.address,
        contracts.dchfToken.address,
        contracts.sortedTroves.address,
        MONContracts.communityIssuance.address,
        contracts.dfrancParameters.address
      )

      await MONContracts.monToken.approve(MONContracts.communityIssuance.address, ethers.constants.MaxUint256)
    })

    it('AddNewCollateral: As User then reverts', async () => {
      await assertRevert(
        adminContract.addNewCollateral(
          stabilityPoolV1.address,
          ZERO_ADDRESS,
          ZERO_ADDRESS,
          dec(100, 18),
          dec(1, 18),
          14,
          { from: user }
        )
      )
    })

    it('AddNewCollateral: As Owner - Invalid StabilityPool Template then reverts', async () => {
      await assertRevert(
        adminContract.addNewCollateral(ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, dec(100, 18), dec(1, 18), 14)
      )
    })

    it('AddNewCollateral: As Owner - Stability Pool exists, then reverts', async () => {
      await assertRevert(
        adminContract.addNewCollateral(stabilityPoolV1.address, ZERO_ADDRESS, ZERO_ADDRESS, 0, dec(1, 18), 14)
      )
    })

    it('AddNewCollateral: As Owner - Create new Stability Pool - Verify All Systems', async () => {
      await adminContract.addNewCollateral(
        stabilityPoolV3.address,
        fakeOracle,
        fakeIndex,
        dec(100, 18),
        dec(1, 18),
        14
      )

      dataOracle = await contracts.priceFeedTestnet.oracles(dchfToken.address)
      assert.equal(dataOracle[0], fakeOracle)
      assert.equal(dataOracle[1], fakeIndex)
      assert.equal(dataOracle[2], true)

      assert.notEqual((await contracts.dfrancParameters.redemptionBlock(dchfToken.address)).toString(), 0)
      assert.notEqual(await stabilityPoolManager.unsafeGetAssetStabilityPool(dchfToken.address), ZERO_ADDRESS)
      assert.isTrue((await monToken.balanceOf(MONContracts.communityIssuance.address)).gt(toBN(dec(100, 18))))
      assert.notEqual(await MONContracts.communityIssuance.monDistributionsByPool, 0)
    })
  })
})

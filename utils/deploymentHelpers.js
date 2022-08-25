const SortedTroves = artifacts.require("./SortedTroves.sol")
const TroveManager = artifacts.require("./TroveManager.sol")
const PriceFeedTestnet = artifacts.require("./PriceFeedTestnet.sol")
const DCHFToken = artifacts.require("./DCHFToken.sol")
const ActivePool = artifacts.require("./ActivePool.sol");
const DefaultPool = artifacts.require("./DefaultPool.sol");
const StabilityPool = artifacts.require("./StabilityPool.sol")
const StabilityPoolManager = artifacts.require("./StabilityPoolManager.sol")
const AdminContract = artifacts.require("./AdminContract.sol")
const GasPool = artifacts.require("./GasPool.sol")
const CollSurplusPool = artifacts.require("./CollSurplusPool.sol")
const FunctionCaller = artifacts.require("./TestContracts/FunctionCaller.sol")
const BorrowerOperations = artifacts.require("./BorrowerOperations.sol")
const HintHelpers = artifacts.require("./HintHelpers.sol")
const DfrancParameters = artifacts.require("./DfrancParameters.sol")
const LockedMON = artifacts.require("./LockedMON.sol")

const MONStaking = artifacts.require("./MONStaking.sol")
const CommunityIssuance = artifacts.require("./CommunityIssuance.sol")

const MONTokenTester = artifacts.require("./MONTokenTester.sol")
const CommunityIssuanceTester = artifacts.require("./CommunityIssuanceTester.sol")
const StabilityPoolTester = artifacts.require("./StabilityPoolTester.sol")
const ActivePoolTester = artifacts.require("./ActivePoolTester.sol")
const DefaultPoolTester = artifacts.require("./DefaultPoolTester.sol")
const DfrancMathTester = artifacts.require("./DfrancMathTester.sol")
const BorrowerOperationsTester = artifacts.require("./BorrowerOperationsTester.sol")
const TroveManagerTester = artifacts.require("./TroveManagerTester.sol")
const DCHFTokenTester = artifacts.require("./DCHFTokenTester.sol")
const ERC20Test = artifacts.require("./ERC20Test.sol")

// Proxy scripts
const BorrowerOperationsScript = artifacts.require('BorrowerOperationsScript')
const BorrowerWrappersScript = artifacts.require('BorrowerWrappersScript')
const TroveManagerScript = artifacts.require('TroveManagerScript')
const StabilityPoolScript = artifacts.require('StabilityPoolScript')
const TokenScript = artifacts.require('TokenScript')
const MONStakingScript = artifacts.require('MONStakingScript')
const { messagePrefix } = require('@ethersproject/hash');
const {
  buildUserProxies,
  BorrowerOperationsProxy,
  BorrowerWrappersProxy,
  TroveManagerProxy,
  StabilityPoolProxy,
  SortedTrovesProxy,
  TokenProxy,
  MONStakingProxy
} = require('../utils/proxyHelpers.js')

/* "Liquity core" consists of all contracts in the core Liquity system.

MON contracts consist of only those contracts related to the MON Token:

-the MON token
-the Lockup factory and lockup contracts
-the MONStaking contract
-the CommunityIssuance contract 
*/

const testHelpers = require("./testHelpers.js")

const th = testHelpers.TestHelper
const dec = th.dec

const ZERO_ADDRESS = '0x' + '0'.repeat(40)
const maxBytes32 = '0x' + 'f'.repeat(64)

class DeploymentHelper {

  static async deployLiquityCore() {
    return this.deployLiquityCoreHardhat()
  }

  static async deployLiquityCoreHardhat() {
    const priceFeedTestnet = await PriceFeedTestnet.new()
    const sortedTroves = await SortedTroves.new()
    const troveManager = await TroveManager.new()
    const activePool = await ActivePool.new()
    const stabilityPoolTemplate = await StabilityPool.new()
    const stabilityPoolTemplateV2 = await StabilityPool.new()
    const stabilityPoolManager = await StabilityPoolManager.new()
    const dfrancParameters = await DfrancParameters.new()
    const gasPool = await GasPool.new()
    const defaultPool = await DefaultPool.new()
    const collSurplusPool = await CollSurplusPool.new()
    const functionCaller = await FunctionCaller.new()
    const borrowerOperations = await BorrowerOperations.new()
    const hintHelpers = await HintHelpers.new()
    const dchfToken = await DCHFToken.new(
      troveManager.address,
      stabilityPoolManager.address,
      borrowerOperations.address,
    )
    const erc20 = await ERC20Test.new()
    const adminContract = await AdminContract.new();


    DCHFToken.setAsDeployed(dchfToken)
    DefaultPool.setAsDeployed(defaultPool)
    PriceFeedTestnet.setAsDeployed(priceFeedTestnet)
    SortedTroves.setAsDeployed(sortedTroves)
    TroveManager.setAsDeployed(troveManager)
    ActivePool.setAsDeployed(activePool)
    StabilityPool.setAsDeployed(stabilityPoolTemplate)
    StabilityPool.setAsDeployed(stabilityPoolTemplateV2)
    GasPool.setAsDeployed(gasPool)
    CollSurplusPool.setAsDeployed(collSurplusPool)
    FunctionCaller.setAsDeployed(functionCaller)
    BorrowerOperations.setAsDeployed(borrowerOperations)
    HintHelpers.setAsDeployed(hintHelpers)
    DfrancParameters.setAsDeployed(dfrancParameters);
    ERC20Test.setAsDeployed(erc20);
    AdminContract.setAsDeployed(adminContract);

    await erc20.setDecimals(8);

    const coreContracts = {
      priceFeedTestnet,
      dchfToken,
      sortedTroves,
      troveManager,
      activePool,
      stabilityPoolTemplate,
      stabilityPoolTemplateV2,
      stabilityPoolManager,
      dfrancParameters,
      gasPool,
      defaultPool,
      collSurplusPool,
      functionCaller,
      borrowerOperations,
      hintHelpers,
      erc20,
      adminContract
    }
    return coreContracts
  }

  static async deployTesterContractsHardhat() {
    const testerContracts = {}

    // Contract without testers (yet)
    testerContracts.erc20 = await ERC20Test.new();
    testerContracts.priceFeedTestnet = await PriceFeedTestnet.new()
    testerContracts.sortedTroves = await SortedTroves.new()
    // Actual tester contracts
    testerContracts.communityIssuance = await CommunityIssuanceTester.new()
    testerContracts.activePool = await ActivePoolTester.new()
    testerContracts.defaultPool = await DefaultPoolTester.new()
    testerContracts.stabilityPoolTemplate = await StabilityPoolTester.new()
    testerContracts.stabilityPoolManager = await StabilityPoolManager.new()
    testerContracts.dfrancParameters = await DfrancParameters.new()
    testerContracts.gasPool = await GasPool.new()
    testerContracts.collSurplusPool = await CollSurplusPool.new()
    testerContracts.math = await DfrancMathTester.new()
    testerContracts.borrowerOperations = await BorrowerOperationsTester.new()
    testerContracts.troveManager = await TroveManagerTester.new()
    testerContracts.functionCaller = await FunctionCaller.new()
    testerContracts.hintHelpers = await HintHelpers.new()
    testerContracts.dchfToken = await DCHFTokenTester.new(
      testerContracts.troveManager.address,
      testerContracts.stabilityPoolManager.address,
      testerContracts.borrowerOperations.address
    )
    testerContracts.adminContract = await AdminContract.new();

    return testerContracts
  }

  static async deployMONContractsHardhat(treasury) {
    const monStaking = await MONStaking.new()
    const communityIssuance = await CommunityIssuanceTester.new()
    const lockedMON = await LockedMON.new();

    MONStaking.setAsDeployed(monStaking)
    CommunityIssuanceTester.setAsDeployed(communityIssuance)
    LockedMON.setAsDeployed(lockedMON)

    // Deploy MON Token, passing Community Issuance and Factory addresses to the constructor 
    const monToken = await MONTokenTester.new(treasury)
    MONTokenTester.setAsDeployed(monToken)

    const MONContracts = {
      monStaking,
      communityIssuance,
      monToken,
      lockedMON
    }
    return MONContracts
  }

  static async deployDCHFToken(contracts) {
    contracts.dchfToken = await DCHFTokenTester.new(
      contracts.troveManager.address,
      contracts.stabilityPoolManager.address,
      contracts.borrowerOperations.address,
    )
    return contracts
  }

  static async deployProxyScripts(contracts, MONContracts, owner, users) {
    const proxies = await buildUserProxies(users)

    const borrowerWrappersScript = await BorrowerWrappersScript.new(
      contracts.borrowerOperations.address,
      contracts.troveManager.address,
      MONContracts.monStaking.address
    )
    contracts.borrowerWrappers = new BorrowerWrappersProxy(owner, proxies, borrowerWrappersScript.address)

    const borrowerOperationsScript = await BorrowerOperationsScript.new(contracts.borrowerOperations.address)
    contracts.borrowerOperations = new BorrowerOperationsProxy(owner, proxies, borrowerOperationsScript.address, contracts.borrowerOperations)

    const troveManagerScript = await TroveManagerScript.new(contracts.troveManager.address)
    contracts.troveManager = new TroveManagerProxy(owner, proxies, troveManagerScript.address, contracts.troveManager)

    const stabilityPoolScript = await StabilityPoolScript.new(contracts.stabilityPoolTemplate.address)
    contracts.stabilityPool = new StabilityPoolProxy(owner, proxies, stabilityPoolScript.address, contracts.stabilityPool)

    contracts.sortedTroves = new SortedTrovesProxy(owner, proxies, contracts.sortedTroves)

    const dchfTokenScript = await TokenScript.new(contracts.dchfToken.address)
    contracts.dchfToken = new TokenProxy(owner, proxies, dchfTokenScript.address, contracts.dchfToken)

    const monTokenScript = await TokenScript.new(MONContracts.monToken.address)
    MONContracts.monToken = new TokenProxy(owner, proxies, monTokenScript.address, MONContracts.monToken)

    const monStakingScript = await MONStakingScript.new(MONContracts.monStaking.address)
    MONContracts.monStaking = new MONStakingProxy(owner, proxies, monStakingScript.address, MONContracts.monStaking)
  }

  // Connect contracts to their dependencies
  static async connectCoreContracts(contracts, MONContracts) {

    // set TroveManager addr in SortedTroves
    await contracts.sortedTroves.setParams(
      contracts.troveManager.address,
      contracts.borrowerOperations.address
    )

    // set contract addresses in the FunctionCaller 
    await contracts.functionCaller.setTroveManagerAddress(contracts.troveManager.address)
    await contracts.functionCaller.setSortedTrovesAddress(contracts.sortedTroves.address)

    await contracts.dfrancParameters.setAddresses(
      contracts.activePool.address,
      contracts.defaultPool.address,
      contracts.priceFeedTestnet.address,
      contracts.adminContract.address
    )

    // set contracts in the Trove Manager
    await contracts.troveManager.setAddresses(
      contracts.borrowerOperations.address,
      contracts.stabilityPoolManager.address,
      contracts.gasPool.address,
      contracts.collSurplusPool.address,
      contracts.dchfToken.address,
      contracts.sortedTroves.address,
      MONContracts.monStaking.address,
      contracts.dfrancParameters.address
    )

    // set contracts in BorrowerOperations 
    await contracts.borrowerOperations.setAddresses(
      contracts.troveManager.address,
      contracts.stabilityPoolManager.address,
      contracts.gasPool.address,
      contracts.collSurplusPool.address,
      contracts.sortedTroves.address,
      contracts.dchfToken.address,
      MONContracts.monStaking.address,
      contracts.dfrancParameters.address
    )

    await contracts.stabilityPoolManager.setAddresses(contracts.adminContract.address)

    await contracts.adminContract.setAddresses(contracts.dfrancParameters.address,
      contracts.stabilityPoolManager.address,
      contracts.borrowerOperations.address,
      contracts.troveManager.address,
      contracts.dchfToken.address,
      contracts.sortedTroves.address,
      MONContracts.communityIssuance.address
    )

    await contracts.activePool.setAddresses(
      contracts.borrowerOperations.address,
      contracts.troveManager.address,
      contracts.stabilityPoolManager.address,
      contracts.defaultPool.address,
      contracts.collSurplusPool.address
    )

    await contracts.defaultPool.setAddresses(
      contracts.troveManager.address,
      contracts.activePool.address,
    )

    await contracts.collSurplusPool.setAddresses(
      contracts.borrowerOperations.address,
      contracts.troveManager.address,
      contracts.activePool.address,
    )

    // set contracts in HintHelpers
    await contracts.hintHelpers.setAddresses(
      contracts.sortedTroves.address,
      contracts.troveManager.address,
      contracts.dfrancParameters.address
    )

  }

  static async connectMONContractsToCore(MONContracts, coreContracts, skipPool = false, liquitySettings = true) {
    const treasurySig = await MONContracts.monToken.treasury();

    await MONContracts.monStaking.setAddresses(
      MONContracts.monToken.address,
      coreContracts.dchfToken.address,
      coreContracts.troveManager.address,
      coreContracts.borrowerOperations.address,
      coreContracts.activePool.address,
      treasurySig
    )

    await MONContracts.monStaking.unpause();

    await MONContracts.communityIssuance.setAddresses(
      MONContracts.monToken.address,
      coreContracts.stabilityPoolManager.address,
      coreContracts.adminContract.address
    )

    await MONContracts.lockedMON.setAddresses(
      MONContracts.monToken.address)

    if (skipPool) {
      return;
    }

    if (await coreContracts.adminContract.owner() != treasurySig)
      await coreContracts.adminContract.transferOwnership(treasurySig);

    await MONContracts.monToken.approve(MONContracts.communityIssuance.address, ethers.constants.MaxUint256, { from: treasurySig });

    const supply = dec(32000000, 18);
    const weeklyReward = dec(32000000 / 4, 18);

    await coreContracts.adminContract.addNewCollateral(ZERO_ADDRESS, coreContracts.stabilityPoolTemplate.address, ZERO_ADDRESS, ZERO_ADDRESS, supply, weeklyReward, 0, { from: treasurySig });
    await MONContracts.monToken.unprotectedMint(treasurySig, supply)
    await coreContracts.adminContract.addNewCollateral(coreContracts.erc20.address, coreContracts.stabilityPoolTemplate.address, ZERO_ADDRESS, ZERO_ADDRESS, supply, weeklyReward, 0, { from: treasurySig });

    if (!liquitySettings)
      return;

    //Set Liquity Configs (since the tests have been designed with it)
    await coreContracts.dfrancParameters.setCollateralParameters(
      ZERO_ADDRESS,
      "1100000000000000000",
      "1500000000000000000",
      dec(200, 18),
      dec(1800, 18),
      200,
      50,
      500,
      50
    );

    await coreContracts.dfrancParameters.setCollateralParameters(
      coreContracts.erc20.address,
      "1100000000000000000",
      "1500000000000000000",
      dec(200, 18),
      dec(1800, 18),
      200,
      50,
      500,
      50
    )
  }
}
module.exports = DeploymentHelper

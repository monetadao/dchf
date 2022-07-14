const { ChainlinkAggregatorV3Interface } = require("./ABIs/ChainlinkAggregatorV3Interface.js")
const { TestHelper: th, TimeValues: timeVals } = require("../utils/testHelpers.js")
const { dec } = th

const MainnetDeploymentHelper = require("../utils/mainnetDeploymentHelpers.js")
const { ZERO_ADDRESS } = require("@openzeppelin/test-helpers/src/constants")
const { ethers } = require("hardhat")
const toBN = ethers.BigNumber.from


let mdh;
let config;
let deployerWallet;
let gasPrice;
let vestaCore;
let MONContracts;
let deploymentState;

let ADMIN_WALLET
let TREASURY_WALLET

async function mainnetDeploy(configParams) {
  console.log(new Date().toUTCString())

  config = configParams;
  gasPrice = config.GAS_PRICE;

  ADMIN_WALLET = config.vestaAddresses.ADMIN_MULTI
  TREASURY_WALLET = config.vestaAddresses.MON_SAFE

  deployerWallet = (await ethers.getSigners())[0]
  mdh = new MainnetDeploymentHelper(config, deployerWallet)

  deploymentState = mdh.loadPreviousDeployment()

  console.log(`deployer address: ${deployerWallet.address}`)
  assert.equal(deployerWallet.address, config.vestaAddresses.DEPLOYER)

  console.log(`deployerETHBalance before: ${await ethers.provider.getBalance(deployerWallet.address)}`)

  if (config.MON_TOKEN_ONLY) {
    console.log("INIT MON ONLY");
    const partialContracts = await mdh.deployPartially(TREASURY_WALLET, deploymentState);

    // create vesting rule to beneficiaries
    console.log("Beneficiaries")

    if ((await partialContracts.MONToken.allowance(deployerWallet.address, partialContracts.lockedVsta.address)) == 0)
      await partialContracts.MONToken.approve(partialContracts.lockedVsta.address, ethers.constants.MaxUint256)

    for (const [wallet, amount] of Object.entries(config.beneficiaries)) {

      if (amount == 0) continue

      if (!(await partialContracts.lockedVsta.isEntityExits(wallet))) {
        console.log("Beneficiary: %s for %s", wallet, amount)

        const txReceipt = await mdh.sendAndWaitForTransaction(partialContracts.lockedVsta.addEntityVesting(wallet, dec(amount, 18)))

        deploymentState[wallet] = {
          amount: amount,
          txHash: txReceipt.transactionHash
        }

        mdh.saveDeployment(deploymentState)
      }
    }

    await transferOwnership(partialContracts.lockedVsta, TREASURY_WALLET);


    const balance = await partialContracts.MONToken.balanceOf(deployerWallet.address);
    console.log(`Sending ${balance} MON to ${TREASURY_WALLET}`);
    await partialContracts.MONToken.transfer(TREASURY_WALLET, balance)

    console.log(`deployerETHBalance after: ${await ethers.provider.getBalance(deployerWallet.address)}`)

    return;
  }

  // Deploy core logic contracts
  vestaCore = await mdh.deployLiquityCoreMainnet(deploymentState, ADMIN_WALLET)

  await mdh.logContractObjects(vestaCore)

  // Deploy MON Contracts
  MONContracts = await mdh.deployMONContractsMainnet(
    TREASURY_WALLET, // multisig MON endowment address
    deploymentState,
  )

  // Connect all core contracts up
  console.log("Connect Core Contracts up");


  await mdh.connectCoreContractsMainnet(
    vestaCore,
    MONContracts
  )

  console.log("Connect MON Contract to Core");
  await mdh.connectMONContractsToCoreMainnet(MONContracts, vestaCore, TREASURY_WALLET)


  console.log("Adding Collaterals");
  const allowance = (await MONContracts.MONToken.allowance(deployerWallet.address, MONContracts.communityIssuance.address));
  if (allowance == 0)
    await MONContracts.MONToken.approve(MONContracts.communityIssuance.address, ethers.constants.MaxUint256)


  await addETHCollaterals();
  await addBTCCollaterals();
  // await addGOHMCollaterals();

  mdh.saveDeployment(deploymentState)

  await mdh.deployMultiTroveGetterMainnet(vestaCore, deploymentState)
  await mdh.logContractObjects(MONContracts)

  await giveContractsOwnerships();

}

async function addETHCollaterals() {

  const ETHAddress = !config.IsMainnet
    ? await mdh.deployMockERC20Contract(deploymentState, "mockETH", 18)
    : config.externalAddrs.WETH_ERC20

  if (!ETHAddress || ETHAddress == "")
    throw ("CANNOT FIND THE ETH Address")

  if ((await vestaCore.stabilityPoolManager.unsafeGetAssetStabilityPool(ETHAddress)) == ZERO_ADDRESS) {

    console.log("Creating Collateral - ETH")

    const stabilityPoolETHProxy = await upgrades.deployProxy(await mdh.getFactory("StabilityPool"), [
      ETHAddress,
      vestaCore.borrowerOperations.address,
      vestaCore.troveManager.address,
      vestaCore.troveManagerHelpers.address,
      vestaCore.dchfToken.address,
      vestaCore.sortedTroves.address,
      MONContracts.communityIssuance.address,
      vestaCore.vestaParameters.address
    ], { initializer: 'setAddresses' });

    await stabilityPoolETHProxy.deployed();

    const txReceiptProxyETH = await mdh
      .sendAndWaitForTransaction(
        vestaCore.adminContract.addNewCollateral(
          stabilityPoolETHProxy.address,
          config.externalAddrs.CHAINLINK_ETHUSD_PROXY,
          config.externalAddrs.CHAINLINK_USDCHF_PROXY,
          dec(100_000, 18),
          toBN(dec(100_000, 18)).div(toBN(4)),
          config.REDEMPTION_SAFETY), {
        gasPrice,
      })

    deploymentState["ProxyStabilityPoolETH"] = {
      address: await vestaCore.stabilityPoolManager.getAssetStabilityPool(ETHAddress),
      txHash: txReceiptProxyETH.transactionHash
    }
  }
}

async function addBTCCollaterals() {
  const BTCAddress = !config.IsMainnet
    ? await mdh.deployMockERC20Contract(deploymentState, "renBTC", 8)
    : config.externalAddrs.REN_BTC

  if (!BTCAddress || BTCAddress == "")
    throw ("CANNOT FIND THE renBTC Address")

  if ((await vestaCore.stabilityPoolManager.unsafeGetAssetStabilityPool(BTCAddress)) == ZERO_ADDRESS) {
    console.log("Creating Collateral - BTC")

    const stabilityPoolBTCProxy = await upgrades.deployProxy(await mdh.getFactory("StabilityPool"), [
      BTCAddress,
      vestaCore.borrowerOperations.address,
      vestaCore.troveManager.address,
      vestaCore.troveManagerHelpers.address,
      vestaCore.dchfToken.address,
      vestaCore.sortedTroves.address,
      MONContracts.communityIssuance.address,
      vestaCore.vestaParameters.address
    ], { initializer: 'setAddresses' });


    await stabilityPoolBTCProxy.deployed();

    const txReceiptProxyBTC = await mdh
      .sendAndWaitForTransaction(
        vestaCore.adminContract.addNewCollateral(
          stabilityPoolBTCProxy.address,
          config.externalAddrs.CHAINLINK_BTCUSD_PROXY,
          config.externalAddrs.CHAINLINK_USDCHF_PROXY,
          dec(100_000, 18),
          toBN(dec(100_000, 18)).div(toBN(4)),
          config.REDEMPTION_SAFETY), {
        gasPrice,
      });

    deploymentState["ProxyStabilityPoolRenBTC"] = {
      address: await vestaCore.stabilityPoolManager.getAssetStabilityPool(BTCAddress),
      txHash: txReceiptProxyBTC.transactionHash
    }
  }
}

async function addGOHMCollaterals() {
  const OHMAddress = !config.IsMainnet
    ? await mdh.deployMockERC20Contract(deploymentState, "gOHM")
    : config.externalAddrs.GOHM


  if (!OHMAddress || OHMAddress == "")
    throw ("CANNOT FIND THE renBTC Address")


  if ((await vestaCore.stabilityPoolManager.unsafeGetAssetStabilityPool(OHMAddress)) == ZERO_ADDRESS) {
    console.log("Creating Collateral - OHM")
    let txReceiptProxyOHM;

    txReceiptProxyOHM = await mdh
      .sendAndWaitForTransaction(
        vestaCore.adminContract.addNewCollateral(
          OHMAddress,
          vestaCore.stabilityPoolV1.address,
          config.externalAddrs.CHAINLINK_OHM_PROXY,
          config.IsMainnet ? config.externalAddrs.CHAINLINK_OHM_INDEX_PROXY : ZERO_ADDRESS,
          dec(30_000, 18),
          toBN(dec(30_000, 18)).div(toBN(4)),
          config.REDEMPTION_SAFETY))

    deploymentState["ProxyStabilityPoolOHM"] = {
      address: await vestaCore.stabilityPoolManager.getAssetStabilityPool(OHMAddress),
      txHash: txReceiptProxyOHM.transactionHash
    }
    //Configure Collateral;
    await mdh.sendAndWaitForTransaction(
      vestaCore.vestaParameters.setMCR(OHMAddress, config.gOHMParameters.MCR)
    );
    await mdh.sendAndWaitForTransaction(
      vestaCore.vestaParameters.setCCR(OHMAddress, config.gOHMParameters.CCR)
    );
    await mdh.sendAndWaitForTransaction(
      vestaCore.vestaParameters.setPercentDivisor(OHMAddress, config.gOHMParameters.PERCENT_DIVISOR)
    );
    await mdh.sendAndWaitForTransaction(
      vestaCore.vestaParameters.setBorrowingFeeFloor(OHMAddress, config.gOHMParameters.BORROWING_FEE_FLOOR)
    );

  }
}

async function giveContractsOwnerships() {
  await transferOwnership(vestaCore.adminContract, ADMIN_WALLET);
  await transferOwnership(vestaCore.priceFeed, ADMIN_WALLET);
  await transferOwnership(vestaCore.vestaParameters, ADMIN_WALLET);
  await transferOwnership(vestaCore.stabilityPoolManager, ADMIN_WALLET);
  await transferOwnership(vestaCore.dchfToken, ADMIN_WALLET);
  await transferOwnership(MONContracts.MONStaking, ADMIN_WALLET);

  await transferOwnership(vestaCore.lockedVsta, TREASURY_WALLET);
  await transferOwnership(MONContracts.communityIssuance, TREASURY_WALLET);
}

async function transferOwnership(contract, newOwner) {

  console.log("Transfering Ownership of", contract.address)

  if (!newOwner)
    throw "Transfering ownership to null address";

  if (await contract.owner() != newOwner)
    await contract.transferOwnership(newOwner)

  console.log("Transfered Ownership of", contract.address)

}

module.exports = {
  mainnetDeploy
}

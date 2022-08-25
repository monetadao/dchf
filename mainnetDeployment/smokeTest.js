const MainnetDeploymentHelper = require("../utils/mainnetDeploymentHelpers.js")
const { ethers } = require("hardhat")
const configParams = require("./deploymentParams.rinkeby.js")


let mdh;
let config;
let deployerWallet;
let gasPrice;
let deploymentState;

let ADMIN_WALLET
let TREASURY_WALLET
let borrowerOperations
let troveManagerHelpers
let dchf
let ethStabilityPool

async function main() {
    console.log(new Date().toUTCString())

    config = configParams;
    gasPrice = config.GAS_PRICE;

    ADMIN_WALLET = config.dfrancAddresses.ADMIN_MULTI
    TREASURY_WALLET = config.dfrancAddresses.VSTA_SAFE

    deployerWallet = (await ethers.getSigners())[0]
    mdh = new MainnetDeploymentHelper(config, deployerWallet)

    deploymentState = mdh.loadPreviousDeployment()

    borrowerOperations = await ethers.getContractAt("BorrowerOperations", deploymentState.borrowerOperations.address);
    troveManagerHelpers = await ethers.getContractAt("TroveManagerHelpers", deploymentState.troveManagerHelpers.address);
    dchf = await ethers.getContractAt("DCHFToken", deploymentState.DCHFToken.address);
    ethStabilityPool = await ethers.getContractAt("StabilityPool", deploymentState.ProxyStabilityPoolETH.address);

    // await openTrove();
    // await investStabilityPool();


    console.log(await borrowerOperations.getEntireSystemColl(config.externalAddrs.WETH_ERC20))
    console.log(await borrowerOperations.getEntireSystemDebt(config.externalAddrs.WETH_ERC20))
    console.log(await troveManagerHelpers.getTroveStatus(config.externalAddrs.WETH_ERC20, deployerWallet.address));
    console.log(await troveManagerHelpers.hasPendingRewards(config.externalAddrs.WETH_ERC20, deployerWallet.address));
    console.log(await dchf.balanceOf(deployerWallet.address));
}

async function investStabilityPool() {
    console.log("invest stability pool");

    const depositAmountDchf = ethers.utils.parseEther("500");

    await dchf.approve(ethStabilityPool.address, depositAmountDchf);

    await ethStabilityPool.provideToSP(depositAmountDchf);

    console.log("provided");

}

async function openTrove() {
    console.log("open trove");

    const depositAmount = ethers.utils.parseEther("1");

    const erc20 = await ethers.getContractAt("IERC20Deposit", config.externalAddrs.WETH_ERC20);
    await erc20.deposit({ value: depositAmount });

    console.log("execute open trove")

    await erc20.approve(borrowerOperations.address, depositAmount);

    await borrowerOperations.openTrove(
        config.externalAddrs.WETH_ERC20,
        depositAmount,
        ethers.utils.parseEther("0.005"),
        ethers.utils.parseEther("650"),
        ethers.constants.AddressZero,
        ethers.constants.AddressZero);

    console.log("trove opened with paramenters:");
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });

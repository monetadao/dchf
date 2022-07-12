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

async function main() {
    console.log(new Date().toUTCString())

    config = configParams;
    gasPrice = config.GAS_PRICE;

    ADMIN_WALLET = config.vestaAddresses.ADMIN_MULTI
    TREASURY_WALLET = config.vestaAddresses.VSTA_SAFE

    deployerWallet = (await ethers.getSigners())[0]
    mdh = new MainnetDeploymentHelper(config, deployerWallet)

    deploymentState = mdh.loadPreviousDeployment()

    await openTrove();

}

async function openTrove() {
    console.log("open trove");

    const depositAmount = ethers.utils.parseEther("1");

    const erc20 = await ethers.getContractAt("IERC20Deposit", config.externalAddrs.WETH_ERC20);
    await erc20.deposit({ value: depositAmount });

    console.log("execute open trove")

    const borrowerOperations = await ethers.getContractAt("BorrowerOperations", deploymentState.borrowerOperations.address);
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

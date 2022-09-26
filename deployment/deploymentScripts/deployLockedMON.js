const { ethers } = require("hardhat");
const configParams = require("../deploymentParams/deploymentParams.mainnet.js")
const DeploymentHelper = require("../helpers/deploymentHelpers.js")


async function main() {
    console.log("Deploying LockedMON");

    config = configParams;
    deployerWallet = (await ethers.getSigners())[0];

    mdh = new DeploymentHelper(config, deployerWallet)
    deploymentState = mdh.loadPreviousDeployment()

    const LockedMON = await ethers.getContractFactory("LockedMON");
    const LockedMONInstance = await mdh.loadOrDeploy(LockedMON, "LockedMON", deploymentState);

    await mdh.verifyContract("LockedMON", deploymentState, [], false);

    await mdh.isOwnershipRenounced(LockedMONInstance) ||
        await mdh.sendAndWaitForTransaction(LockedMONInstance.setAddresses(
            deploymentState["MONToken"].address,
            { gasPrice: config.GAS_PRICE }))

    await mdh.sendAndWaitForTransaction(
        LockedMONInstance.transferOwnership(
            config.dfrancAddresses.ADMIN_MULTI,
            { gasPrice: config.GAS_PRICE }
        ))

}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
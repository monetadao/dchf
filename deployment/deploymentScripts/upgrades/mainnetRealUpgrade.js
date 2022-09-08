const { upgrade } = require('./upgrade.js')
const configParams = require("../../deploymentParams/deploymentParams.mainnet.js")

const CONTRACT_NAME_TO_UPGRADE = "AdminContract";
const CONTRACT_NAME_IN_OUTPUT = "adminContract";

async function main() {
    console.log("Upgrading on mainnet");
    await upgrade(configParams, CONTRACT_NAME_TO_UPGRADE, CONTRACT_NAME_IN_OUTPUT)
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });

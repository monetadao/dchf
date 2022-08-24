-> DCHF Development Repo:

1. Currently the private keys / api keys for deployment are hard-coded in the "hardhat.config.js" file (don't use the git.secrets.js file).

2. In mainnetDeployment/deploymentParams.rinkeby.js it's needed to replace the values between the lines 25-27 to the Deployer's wallet (accordingly to the private key set on hardhat.config.js file). All the oracles addresses are correct and should not be changed. Also the value in line 96 (GAS_PRICE) is set correctly and you risk getting stuck in the deployment if the value is changed.

3. The contract DfrancParameters.sol contains all the parameters from the system and should not be modified. However, the system is set to block redemptions in it's first 14 days. For testing purposes, it's recommended to change it for a lower value. You can find it on the line 15.

-> Call Diagram

![Scheme](DCHFv1.svg)
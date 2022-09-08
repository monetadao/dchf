const DeploymentHelper = require("../../helpers/deploymentHelpers.js")
const { ethers } = require("hardhat")
const { defender } = require("hardhat");

let mdh;
let config;
let deployerWallet;
let deploymentState;

async function upgrade(configParams, contractName, deploymentStateName) {

  console.log(`Deployment time:`, new Date().toUTCString())

  config = configParams;
  mdh = new DeploymentHelper(config, deployerWallet)
  deployerWallet = (await ethers.getSigners())[0]
  deploymentState = mdh.loadPreviousDeployment()

  console.log(`deployer address: ${deployerWallet.address}`)
  console.log(`deployerETHBalance before: ${await ethers.provider.getBalance(deployerWallet.address)}`)

  const proxyAddress = deploymentState[deploymentStateName].address;

  const Contract = await ethers.getContractFactory(contractName);

  console.log("Preparing upgrade...");
  const proposal = await defender.proposeUpgrade(proxyAddress, Contract);
  console.log("Upgrade proposal for contract " + contractName + " created at: " + proposal.url);
}

module.exports = {
  upgrade
}
const DeploymentHelper = require("../helpers/deploymentHelpers.js")
const { ethers } = require("hardhat")


let mdh;
let config;
let deployerWallet;

async function main(configParams) {
    
    console.log(`Deployment time:`, new Date().toUTCString())
    
    mdh = new DeploymentHelper(config, deployerWallet)
    config = configParams;
    deployerWallet = (await ethers.getSigners())[0]
    
    console.log(`deployer address: ${deployerWallet.address}`)
    console.log(`deployerETHBalance before: ${await ethers.provider.getBalance(deployerWallet.address)}`)
  
    const proxyAddress = '0xD45cF22Dd552280CDDd54700f8ab4a5BE5f78fB8';
 
    const AdminContractV2 = await ethers.getContractFactory("AdminContractV2");
    console.log("Preparing upgrade...");
    const admincontractV2address = await upgrades.prepareUpgrade(proxyAddress, AdminContractV2);
    console.log("AdminContractV2 deployed at address:", admincontractV2address);
  }
  
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
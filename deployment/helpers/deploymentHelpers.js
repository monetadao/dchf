const { ParamType } = require('ethers/lib/utils')
const fs = require('fs')

const ZERO_ADDRESS = '0x' + '0'.repeat(40)
const maxBytes32 = '0x' + 'f'.repeat(64)

class DeploymentHelper {
  constructor(configParams, deployerWallet) {
    this.configParams = configParams
    this.deployerWallet = deployerWallet
    this.hre = require("hardhat")
  }

  loadPreviousDeployment() {
    let previousDeployment = {}
    if (fs.existsSync(this.configParams.OUTPUT_FILE)) {
      console.log(`Loading previous deployment...`)
      previousDeployment = require('../.' + this.configParams.OUTPUT_FILE)
    }

    return previousDeployment
  }

  saveDeployment(deploymentState) {
    const deploymentStateJSON = JSON.stringify(deploymentState, null, 2)
    fs.writeFileSync(this.configParams.OUTPUT_FILE, deploymentStateJSON)

  }
  // --- Deployer methods ---

  async getFactory(name) {
    const factory = await ethers.getContractFactory(name, this.deployerWallet)
    return factory
  }

  async sendAndWaitForTransaction(txPromise) {
    const tx = await txPromise
    const minedTx = await ethers.provider.waitForTransaction(tx.hash, this.configParams.TX_CONFIRMATIONS)

    if (!minedTx.status) {
      throw ('Transaction Failed', txPromise);
    }

    return minedTx
  }

  async loadOrDeploy(factory, name, deploymentState, proxy, params = []) {

    if (deploymentState[name] && deploymentState[name].address) {
      console.log(`Using previously deployed ${name} contract at address ${deploymentState[name].address}`)
      return await factory.attach(deploymentState[name].address);
    }

    const contract = proxy
      ? await upgrades.deployProxy(factory)
      : await factory.deploy(...params, { gasPrice: this.configParams.GAS_PRICE });

    await this.deployerWallet.provider.waitForTransaction(contract.deployTransaction.hash, this.configParams.TX_CONFIRMATIONS)

    deploymentState[name] = {
      address: contract.address,
      txHash: contract.deployTransaction.hash
    }

    this.saveDeployment(deploymentState)

    return contract
  }


  async deployMockERC20Contract(deploymentState, name, decimals = 18) {
    const ERC20MockFactory = await this.getFactory("ERC20Mock")
    const erc20Mock = await this.loadOrDeploy(ERC20MockFactory, name, deploymentState, false, [name, name, decimals])

    await erc20Mock.mint(this.deployerWallet.address, "100000".concat("0".repeat(decimals)));

    return erc20Mock.address
  }

  async deployMONToken(treasurySigAddress, deploymentState) {
    const MONTokenFactory = await this.getFactory("MONToken")

    const MONToken = await this.loadOrDeploy(
      MONTokenFactory,
      'MONToken',
      deploymentState,
      false,
      [treasurySigAddress]
    )

    if (!this.configParams.ETHERSCAN_BASE_URL) {
      console.log('No Etherscan Url defined, skipping verification')
    } else {
      await this.verifyContract('MONToken', deploymentState, [treasurySigAddress])
    }

    return MONToken;
  }

  async deployPartially(treasurySigAddress, deploymentState) {
    const MONTokenFactory = await this.getFactory("MONToken")
    const lockedMONFactory = await this.getFactory("LockedMON")

    const lockedMON = await this.loadOrDeploy(lockedMONFactory, 'lockedMON', deploymentState)

    // Deploy MON Token, passing Community Issuance and Factory addresses to the constructor
    const MONToken = await this.loadOrDeploy(
      MONTokenFactory,
      'MONToken',
      deploymentState,
      false,
      [treasurySigAddress]
    )

    if (!this.configParams.ETHERSCAN_BASE_URL) {
      console.log('No Etherscan Url defined, skipping verification')
    } else {
      await this.verifyContract('lockedMON', deploymentState, [])
      await this.verifyContract('MONToken', deploymentState, [treasurySigAddress])
    }

    await this.isOwnershipRenounced(lockedMON) ||
      await this.sendAndWaitForTransaction(lockedMON.setAddresses(
        MONToken.address,
        { gasPrice: this.configParams.GAS_PRICE }
      ))

    const partialContracts = {
      lockedMON,
      MONToken
    }

    return partialContracts
  }


  async deployDchfCoreMainnet(deploymentState, multisig) {
    // Get contract factories
    const priceFeedFactory = await this.getFactory("PriceFeed")
    const sortedTrovesFactory = await this.getFactory("SortedTroves")
    const troveManagerFactory = await this.getFactory("TroveManager")
    const troveManagerHelpersFactory = await this.getFactory("TroveManagerHelpers")
    const activePoolFactory = await this.getFactory("ActivePool")
    const StabilityPoolManagerFactory = await this.getFactory("StabilityPoolManager")
    const gasPoolFactory = await this.getFactory("GasPool")
    const defaultPoolFactory = await this.getFactory("DefaultPool")
    const collSurplusPoolFactory = await this.getFactory("CollSurplusPool")
    const borrowerOperationsFactory = await this.getFactory("BorrowerOperations")
    const hintHelpersFactory = await this.getFactory("HintHelpers")
    const DCHFTokenFactory = await this.getFactory("DCHFToken")
    const vaultParametersFactory = await this.getFactory("DfrancParameters")
    const adminContractFactory = await this.getFactory("AdminContract")

    //// USE PROXY

    //// NO PROXY
    const gasPool = await this.loadOrDeploy(gasPoolFactory, 'gasPool', deploymentState)
    const sortedTroves = await this.loadOrDeploy(sortedTrovesFactory, 'sortedTroves', deploymentState)
    const troveManager = await this.loadOrDeploy(troveManagerFactory, 'troveManager', deploymentState)
    const troveManagerHelpers = await this.loadOrDeploy(troveManagerHelpersFactory, 'troveManagerHelpers', deploymentState)
    const activePool = await this.loadOrDeploy(activePoolFactory, 'activePool', deploymentState)
    const stabilityPoolManager = await this.loadOrDeploy(StabilityPoolManagerFactory, 'stabilityPoolManager', deploymentState)
    const defaultPool = await this.loadOrDeploy(defaultPoolFactory, 'defaultPool', deploymentState)
    const collSurplusPool = await this.loadOrDeploy(collSurplusPoolFactory, 'collSurplusPool', deploymentState)
    const borrowerOperations = await this.loadOrDeploy(borrowerOperationsFactory, 'borrowerOperations', deploymentState)
    const hintHelpers = await this.loadOrDeploy(hintHelpersFactory, 'hintHelpers', deploymentState)
    const dfrancParameters = await this.loadOrDeploy(vaultParametersFactory, 'dfrancParameters', deploymentState)
    const priceFeed = await this.loadOrDeploy(priceFeedFactory, 'priceFeed', deploymentState)
    const adminContract = await this.loadOrDeploy(adminContractFactory, 'adminContract', deploymentState)




    const DCHFTokenParams = [
      stabilityPoolManager.address
    ]
    const dchfToken = await this.loadOrDeploy(
      DCHFTokenFactory,
      'DCHFToken',
      deploymentState,
      false,
      DCHFTokenParams
    )
    // add borrower operations and trove manager to dchf
    if (!(await dchfToken.validTroveManagers(troveManager.address))) {
      await this.sendAndWaitForTransaction(dchfToken.addTroveManager(troveManager.address));
    }
    if (!(await dchfToken.validBorrowerOps(borrowerOperations.address))) {
      await this.sendAndWaitForTransaction(dchfToken.addBorrowerOps(borrowerOperations.address));
    }

    if (!this.configParams.ETHERSCAN_BASE_URL) {
      console.log('No Etherscan Url defined, skipping verification')
    } else {
      await this.verifyContract('priceFeed', deploymentState, [], false)
      await this.verifyContract('sortedTroves', deploymentState, [], false)
      await this.verifyContract('troveManager', deploymentState, [], false)
      await this.verifyContract('troveManagerHelpers', deploymentState, [], false)
      await this.verifyContract('activePool', deploymentState, [], false)
      await this.verifyContract('stabilityPoolManager', deploymentState, [], false)
      await this.verifyContract('gasPool', deploymentState, [], false)
      await this.verifyContract('defaultPool', deploymentState, [], false)
      await this.verifyContract('collSurplusPool', deploymentState, [], false)
      await this.verifyContract('borrowerOperations', deploymentState, [], false)
      await this.verifyContract('hintHelpers', deploymentState, [], false)
      await this.verifyContract('DCHFToken', deploymentState, DCHFTokenParams)
      await this.verifyContract('dfrancParameters', deploymentState, [], false)
      await this.verifyContract('adminContract', deploymentState, [], false)
    }

    const coreContracts = {
      priceFeed,
      dchfToken,
      sortedTroves,
      troveManager,
      troveManagerHelpers,
      activePool,
      stabilityPoolManager,
      adminContract,
      gasPool,
      defaultPool,
      collSurplusPool,
      borrowerOperations,
      hintHelpers,
      dfrancParameters
    }


    return coreContracts
  }

  async deployMONContractsMainnet(treasurySigAddress, deploymentState) {
    const MONStakingFactory = await this.getFactory("MONStaking")
    const communityIssuanceFactory = await this.getFactory("CommunityIssuance")
    const MONTokenFactory = await this.getFactory("MONToken")

    const MONStaking = await this.loadOrDeploy(MONStakingFactory, 'MONStaking', deploymentState)
    const communityIssuance = await this.loadOrDeploy(communityIssuanceFactory, 'communityIssuance', deploymentState)

    // Deploy MON Token, passing Community Issuance and Factory addresses to the constructor
    const MONToken = await this.loadOrDeploy(
      MONTokenFactory,
      'MONToken',
      deploymentState,
      false,
      [treasurySigAddress]
    )

    if (!this.configParams.ETHERSCAN_BASE_URL) {
      console.log('No Etherscan Url defined, skipping verification')
    } else {
      await this.verifyContract('MONStaking', deploymentState)
      await this.verifyContract('communityIssuance', deploymentState)
      await this.verifyContract('MONToken', deploymentState, [treasurySigAddress])
    }

    const MONContracts = {
      MONStaking,
      communityIssuance,
      MONToken
    }
    return MONContracts
  }

  async deployMultiTroveGetterMainnet(dchfCore, deploymentState) {
    const multiTroveGetterFactory = await this.getFactory("MultiTroveGetter")
    const multiTroveGetterParams = [
      dchfCore.troveManager.address,
      dchfCore.troveManagerHelpers.address,
      dchfCore.sortedTroves.address
    ]
    const multiTroveGetter = await this.loadOrDeploy(
      multiTroveGetterFactory,
      'multiTroveGetter',
      deploymentState,
      false,
      multiTroveGetterParams
    )

    if (!this.configParams.ETHERSCAN_BASE_URL) {
      console.log('No Etherscan Url defined, skipping verification')
    } else {
      await this.verifyContract('multiTroveGetter', deploymentState, multiTroveGetterParams)
    }

    return multiTroveGetter
  }
  // --- Connector methods ---

  async isOwnershipRenounced(contract) {
    const isInitialized = await contract.isInitialized();
    console.log("%s Is Initalized : %s", await contract.NAME(), isInitialized);
    return isInitialized;
  }
  // Connect contracts to their dependencies
  async connectCoreContractsMainnet(contracts, MONContracts) {

    const gasPrice = this.configParams.GAS_PRICE

    await this.isOwnershipRenounced(contracts.priceFeed) ||
      await this.sendAndWaitForTransaction(contracts.priceFeed.setAddresses(
        contracts.adminContract.address,
        { gasPrice }))

    await this.isOwnershipRenounced(contracts.sortedTroves) ||
      await this.sendAndWaitForTransaction(contracts.sortedTroves.setParams(
        contracts.troveManager.address,
        contracts.troveManagerHelpers.address,
        contracts.borrowerOperations.address,
        { gasPrice }
      ))
    await this.isOwnershipRenounced(contracts.dfrancParameters) ||
      await this.sendAndWaitForTransaction(contracts.dfrancParameters.setAddresses(
        contracts.activePool.address,
        contracts.defaultPool.address,
        contracts.priceFeed.address,
        contracts.adminContract.address,
        { gasPrice }
      ))

    await this.isOwnershipRenounced(contracts.troveManager) ||
      await this.sendAndWaitForTransaction(contracts.troveManager.setAddresses(
        contracts.stabilityPoolManager.address,
        contracts.gasPool.address,
        contracts.collSurplusPool.address,
        contracts.dchfToken.address,
        contracts.sortedTroves.address,
        MONContracts.MONStaking.address,
        contracts.dfrancParameters.address,
        contracts.troveManagerHelpers.address,
        { gasPrice }
      ))

    await this.isOwnershipRenounced(contracts.troveManagerHelpers) ||
      await this.sendAndWaitForTransaction(contracts.troveManagerHelpers.setAddresses(
        contracts.borrowerOperations.address,
        contracts.dchfToken.address,
        contracts.sortedTroves.address,
        contracts.dfrancParameters.address,
        contracts.troveManager.address,
        { gasPrice }
      ))

    await this.isOwnershipRenounced(contracts.borrowerOperations) ||
      await this.sendAndWaitForTransaction(contracts.borrowerOperations.setAddresses(
        contracts.troveManager.address,
        contracts.troveManagerHelpers.address,
        contracts.stabilityPoolManager.address,
        contracts.gasPool.address,
        contracts.collSurplusPool.address,
        contracts.sortedTroves.address,
        contracts.dchfToken.address,
        MONContracts.MONStaking.address,
        contracts.dfrancParameters.address,
        { gasPrice }
      ))

    await this.isOwnershipRenounced(contracts.stabilityPoolManager) ||
      await this.sendAndWaitForTransaction(contracts.stabilityPoolManager.setAddresses(
        contracts.adminContract.address,
        { gasPrice }
      ))

    await this.isOwnershipRenounced(contracts.activePool) ||
      await this.sendAndWaitForTransaction(contracts.activePool.setAddresses(
        contracts.borrowerOperations.address,
        contracts.troveManager.address,
        contracts.troveManagerHelpers.address,
        contracts.stabilityPoolManager.address,
        contracts.defaultPool.address,
        contracts.collSurplusPool.address,
        { gasPrice }
      ))

    await this.isOwnershipRenounced(contracts.defaultPool) ||
      await this.sendAndWaitForTransaction(contracts.defaultPool.setAddresses(
        contracts.troveManager.address,
        contracts.troveManagerHelpers.address,
        contracts.activePool.address,
        { gasPrice }
      ))

    await this.isOwnershipRenounced(contracts.collSurplusPool) ||
      await this.sendAndWaitForTransaction(contracts.collSurplusPool.setAddresses(
        contracts.borrowerOperations.address,
        contracts.troveManager.address,
        contracts.troveManagerHelpers.address,
        contracts.activePool.address,
        { gasPrice }
      ))

    await this.isOwnershipRenounced(contracts.adminContract) ||
      await this.sendAndWaitForTransaction(contracts.adminContract.setAddresses(
        contracts.dfrancParameters.address,
        contracts.stabilityPoolManager.address,
        contracts.borrowerOperations.address,
        contracts.troveManager.address,
        contracts.troveManagerHelpers.address,
        contracts.dchfToken.address,
        contracts.sortedTroves.address,
        MONContracts.communityIssuance.address,
        { gasPrice }
      ))

    // set contracts in HintHelpers
    await this.isOwnershipRenounced(contracts.hintHelpers) ||
      await this.sendAndWaitForTransaction(contracts.hintHelpers.setAddresses(
        contracts.sortedTroves.address,
        contracts.troveManager.address,
        contracts.troveManagerHelpers.address,
        contracts.dfrancParameters.address,
        { gasPrice }
      ))
  }

  async connectMONContractsToCoreMainnet(MONContracts, coreContracts, treasuryAddress) {
    const gasPrice = this.configParams.GAS_PRICE
    await this.isOwnershipRenounced(MONContracts.MONStaking) ||
      await this.sendAndWaitForTransaction(MONContracts.MONStaking.setAddresses(
        MONContracts.MONToken.address,
        coreContracts.dchfToken.address,
        coreContracts.troveManager.address,
        coreContracts.troveManagerHelpers.address,
        coreContracts.borrowerOperations.address,
        coreContracts.activePool.address,
        treasuryAddress,
        { gasPrice }
      ))

    await this.isOwnershipRenounced(MONContracts.communityIssuance) ||
      await this.sendAndWaitForTransaction(MONContracts.communityIssuance.setAddresses(
        MONContracts.MONToken.address,
        coreContracts.stabilityPoolManager.address,
        coreContracts.adminContract.address,
        { gasPrice }
      ))
  }

  // --- Verify on Ethrescan ---
  async verifyContract(name, deploymentState, constructorArguments = [], proxy = false) {
    if (!deploymentState[name] || !deploymentState[name].address) {
      console.error(`  --> No deployment state for contract ${name}!!`)
      return
    }
    if (deploymentState[name].verification && deploymentState[name].verificationImplementation) {
      console.log(`Contract ${name} already verified`)
      return
    }

    if (!deploymentState[name].verification) {
      try {
        await this.hre.run("verify:verify", {
          address: deploymentState[name].address,
          constructorArguments,
        })
      } catch (error) {
        // if it was already verified, it’s like a success, so let’s move forward and save it
        if (error.name != 'NomicLabsHardhatPluginError') {
          console.error(`Error verifying: ${error.name}`)
          console.error(error)
          return
        }
      }

      deploymentState[name].verification = `${this.configParams.ETHERSCAN_BASE_URL}/${deploymentState[name].address}#code`
    }

    if (proxy && !deploymentState[name].verificationImplementation) {
      const implementationAddress = await upgrades.erc1967.getImplementationAddress(deploymentState[name].address);
      try {
        await this.hre.run("verify:verify", {
          address: implementationAddress,
          constructorArguments: [],
        })
      } catch (error) {
        // if it was already verified, it’s like a success, so let’s move forward and save it
        if (error.name != 'NomicLabsHardhatPluginError') {
          console.error(`Error verifying: ${error.name}`)
          console.error(error)
          return
        }
      }

      deploymentState[name].verificationImplementation = `${this.configParams.ETHERSCAN_BASE_URL}/${implementationAddress}#code`

    }

    this.saveDeployment(deploymentState)
  }

  // --- Helpers ---

  async logContractObjects(contracts) {
    console.log(`Contract objects addresses:`)
    for (const contractName of Object.keys(contracts)) {
      console.log(`${contractName}: ${contracts[contractName].address}`);
    }
  }
}

module.exports = DeploymentHelper

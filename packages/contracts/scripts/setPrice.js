// scripts/index.js
async function main () {

// Set up an ethers contract, representing our deployed Box instance
const address = '0x66ef6Dd6CD71D4075E6D42E36B3cFA9E998C45a9';
const PriceFeedTestnet = await ethers.getContractFactory('PriceFeedTestnet');
const priceFeed = await PriceFeedTestnet.attach(address);

// Send a transaction to store() a new value in the Box
await priceFeed.setPrice(1795.373839090510739073);
  }
  
  main()
    .then(() => process.exit(0))
    .catch(error => {
      console.error(error);
      process.exit(1);
    });
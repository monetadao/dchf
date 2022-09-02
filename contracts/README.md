# DCHF Contracts

## General Information

This repository was initially forked from [vesta finance](https://github.com/vesta-finance/vesta-protocol-v1/releases/tag/v1.0) and was changed in order to be deployable on Ethereum Mainnet.
It contains all contracts for the DCHF ecosystem, including Moneta Token, Dependencies and Interfaces.
More detailed information can be found on the [github page of liquity](https://github.com/liquity/dev).

## Important Contracts

### DfrancParameters.sol

All important parameters like the default CCR (Critical Collateralization Ratio) are set here.

### DCHFToken.sol

Contains the compatible ERC-20 DCHF token.

### BorrowerOperations.sol

Serves Borrower operations for the client. E.q. openTrove(...args).

### MONToken.sol

Contains the compatible ERC-20 Moneta token.

### LockedMON.sol

The vesting contract for Moneta Airdrops etc.
